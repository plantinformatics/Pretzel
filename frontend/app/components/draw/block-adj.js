import Ember from 'ember';

const { inject: { service } } = Ember;
import { throttle } from '@ember/runloop';

import PathData from './path-data';

import AxisEvents from '../../utils/draw/axis-events';
import { stacks, Stacked } from '../../utils/stacks';
import { selectAxis, blockAdjKeyFn, blockAdjEltId, featureEltIdPrefix, featureNameClass, foregroundSelector, selectBlockAdj } from '../../utils/draw/stacksAxes';

/* global d3 */

/*----------------------------------------------------------------------------*/

/** Used for CSS selectors targeting <g> and <path>-s generated by this component. */
const className = "blockAdj";
const CompName = 'components/axis-ticks-selected';

const trace_blockAdj = 1;

/*----------------------------------------------------------------------------*/

/**
 * @param blockAdj  [blockId0, blockId1]
 * @param drawMap for Evented - stack events
 */
export default Ember.Component.extend(Ember.Evented, AxisEvents, {
  /** AxisEvents is used to receive axis stacking and resize events.
   *  Evented may be used in future to propagate events to components rendered within block-adj.
   */
  store: service(),
  pathsP : service('data/paths-progressive'),

  needs: ['component:draw/path-data'],

  zoomCounter : 0,

  blockAdj : Ember.computed('blockAdjId', function () {
    let
      blockAdjId = this.get('blockAdjId'),
    record = this.get('pathsP').ensureBlockAdj(blockAdjId);
    console.log('blockAdjId', blockAdjId, blockAdjId[0], blockAdjId[1], record);
    return record;
  }),

  /** Result is, for each blockID in blockAdjId,  the axis on which the block is displayed.
   * Will need to add dependency on stacks component, because block can be un-viewed then re-viewed.
   */
  axes :  Ember.computed('blockAdjId', function () {
    let
      blockAdjId = this.get('blockAdjId'),
    axes = blockAdjId.map(function (blockId) {
      return Stacked.getAxis(blockId);
    });
    console.log('axes', axes);
    return axes;
  }),

  paths : Ember.computed('blockAdj.pathsResult.[]', 'zoomCounter', function () {
    console.log('paths', this);
    let pathsP = this.get('blockAdj.paths');
    pathsP.then((paths) => {
    if (paths && paths.length)
      throttle(this, this.draw, paths, 200, false);
    });
    return pathsP;
  }),

  /*--------------------------------------------------------------------------*/

  isAdjacentToAxis(axisID) {
    let axes = this.get('axes'),
    match = (axes[0].axisName === axisID) || (axes[1].axisName === axisID);
    return match;
  },

  /*--------------------------------------------------------------------------*/

  didRender() {
    this._super(...arguments);
    this.drawGroup();
  },

  /** Render the <g.direct_progress> which contains the <g> and <path>
   * rendered by this component. */
  drawGroup() {
    let foreground = d3.selectAll(foregroundSelector);
    let pS = foreground
      .selectAll('g > g.direct_progress')
      .data([1]),
    pA = pS
      .enter()
      .append('g')
      .attr('class', 'direct_progress'),
    pM = pS.merge(pA);
    console.log('drawGroup', pS.nodes(), pS.node());

    /* render the <g> for this block-adj */
    let
      blockAdjId = this.get('blockAdjId');

    let groupAddedClass = 'block-adj';
    let id = blockAdjEltId(blockAdjId);
    let gS = pM.selectAll('g' + '#' + id + '.' + className + '.' + groupAddedClass);
    /* could use .data(), given a list of all block adjacencies :
     * .data(flowsService.blockAdjs, blockAdjKeyFn); ... gS.enter() ... */
    if (gS.empty()) {
      let gA = pM
        .append('g')
        .datum(blockAdjId)
        .attr('id', blockAdjEltId)
        .attr('class', className + ' ' + groupAddedClass)
      ;
      console.log(gA.nodes(), gA.node(), this);
    }
  },


  /**
   * @param paths grouped by features
   */
  draw (featurePaths) {
    if (featurePaths.length === 0)
      return;

    /** blockAdjId is also contained in the result featurePaths
     */
    let
      blockAdjId = this.get('blockAdjId');

    if (featurePaths[0].alignment.length) {
      const reversed = true;
      let a = featurePaths[0].alignment,
      ok = (a[0].blockId === blockAdjId[0+reversed]) && (a[1].blockId === blockAdjId[1-reversed]);
      if (! ok)
        console.log('draw verify', blockAdjId, a);
    }

    // let axisApi = this.get('drawMap.oa.axisApi');
    if (trace_blockAdj) {
      let axis = stacks.axes[blockAdjId[0]];
      let aS = selectAxis(axis);
      console.log(aS.node());
    }

    let dpS = d3.selectAll(foregroundSelector + '> g.direct_progress');

    let baS = selectBlockAdj(dpS, blockAdjId);
    console.log(baS.nodes(), baS.node());
    
    if (baS.empty())
      console.log('draw', blockAdjId);
    else
    {
      let gS = baS.selectAll("g." + className)
        .data(featurePaths, featurePathKeyFn);
      gS.exit().remove();

      let gA = gS.enter()
        .append('g')
        .attr('id', featureGroupIdFn) 
        .attr('class', className)
      ;
      function featureGroupIdFn(featurePath) {
        let a = featurePath.alignment,
        id = [a[0].blockId, a[1].blockId];
        return blockAdjEltId(id) + '_' + featureEltId(featurePath);
      }


      console.log('PathData', PathData);
      let gSA = gS.merge(gA),
      owner = Ember.getOwner(this),
      pS = gSA
        .selectAll("path." + className)
        .data(pathsOfFeature(owner), locationPairKeyFn),
      pSE = pS.enter()
        .append("path")
        .attr("class", className)
      ;
      pSE
        .attr("d", function(d) { return d.pathU() /*get('pathU')*/; });
      // setupMouseHover(pSE);

    }

  },

  /** Update the "d" attribute of the <path>-s.  */
  updatePathsPosition() {
    // based on draw().
    let dpS = d3.selectAll(foregroundSelector + '> g.direct_progress');
    let blockAdjId = this.get('blockAdjId');
    if (trace_blockAdj > 1)
      blockAdjId.forEach(function (blockId) {
        let axis = Stacked.getAxis(blockId);
        let y = stacks.oa.y[axis.axisName];
        console.log('updatePathsPosition axis', axis.axisName, y.domain(), axis, y.domain());
      });
    let baS = selectBlockAdj(dpS, blockAdjId);
    // let groupAddedClass = featurePaths[0]._id.name;
    //  + '.' + groupAddedClass
    let gS = baS.selectAll("g." + className),
    pS = gS
      .selectAll("path." + className);
    // Remove <path>s whose data refers to a block which has been removed from its axis.
    // later the block-adj will be removed, which will remove all contents.
    let removed = pS
      .filter(function (d) { return ! d.blocksHaveAxes(); });
    if (! removed.empty())
        console.log('updatePathsPosition removed', removed.nodes(), removed.node());
    removed.remove();
    pS = gS
      .selectAll("path." + className)
      // don't call pathU() if axes are gone.
      .filter(function (d) { return d.blocksHaveAxes(); });
    if (! pS.empty())
        console.log('updatePathsPosition before update pS', pS.nodes(), pS.node());
    /* now that paths are within <g.block-adj>, path position can be altered
     * during dragging by updating a skew transform of <g.block-adj>, instead of
     * repeatedly recalculating pathU.
     */
    pS
      // pathU() is temporarily a function, will revert to a computed function, as commented in path().
      .attr("d", function(d) { return d.pathU() /*get('pathU')*/; });
  },

  /*--------------------------------------------------------------------------*/

  /** call updatePathsPosition().
   * filter / debounce the calls to handle multiple events at the same time.
   * @param axisID_t is defined by zoomedAxis(), undefined when called from
   * axisStackChanged()
   */
  updatePathsPositionDebounce(axisID_t) {
    console.log('updatePathsPositionDebounce', axisID_t);
    // updatePathsPosition() doesn't use axisID_t; this call chain is likely to be refined yet.
    /* may use .throttle() instead of .debounce();  (throttle has default immediate==true).
     * It is possible that the last event in a group may indicate a change which
     * should be rendered, but in this case it is likely there is no change
     * after the first event in the group.
     */
    Ember.run.debounce(this, this.updatePathsPosition, axisID_t, 500);
  },

  /*--------------------------------------------------------------------------*/
  
  /** block-adj receives axisStackChanged and zoomedAxis from draw-map
   */

  resized : function(widthChanged, heightChanged, useTransition) {
    /* useTransition could be passed down to draw()
     * (also could pass in duration or t from showResize()).
     */
    console.log("resized in components/block-adj");
    /* In addition to the usual causes of repeated events, block-adj will
     * respond to events relating to 2 axes. */
    if (heightChanged)
      this.updatePathsPositionDebounce();
  },

  axisStackChanged : function() {
    console.log("axisStackChanged in components/block-adj");
    this.updatePathsPositionDebounce();
  },

  /** @param [axisID, t] */
  zoomedAxis : function(axisID_t) {
    let axisID = axisID_t[0],
    blockAdjId = this.get('blockAdjId'),
    axes = this.get('axes');
    if (trace_blockAdj > 1)
      console.log("zoomedAxis in ", CompName, axisID_t, blockAdjId, axes);
    /* zoomedAxis is specific to an axisID, so respond to that if
     * blockAdjId[0] or blockAdjId[1] are on this.axis.
     */
    if (this.isAdjacentToAxis(axisID))
    {
      console.log('zoomedAxis matched', axisID, blockAdjId, axes);
      // paths positions are updated by event axisStackChanged() already received.
      // With zoom, the densityCount() result changes so request paths again
      this.incrementProperty('zoomCounter');
      this.get('blockAdj').incrementProperty('zoomCounter');
    }
  }
  /*--------------------------------------------------------------------------*/

  
});

if (false) {
  /** Example of param paths passed to draw() above. */
  const examplePaths = 
[{"_id":{"name":"myMarkerC"},
  "alignment":[
      {"blockId":"5c75d4f8792ccb326827daa2","repeats":{
	  "_id":{"name":"myMarkerC","blockId":"5c75d4f8792ccb326827daa2"},
	  "features":[{"_id":"5c75d4f8792ccb326827daa6","name":"myMarkerC","value":[3.1,3.1],"blockId":"5c75d4f8792ccb326827daa2","parentId":null}],"count":1}},
      {"blockId":"5c75d4f8792ccb326827daa1","repeats":{
	  "_id":{"name":"myMarkerC","blockId":"5c75d4f8792ccb326827daa1"},
	      "features":[{"_id":"5c75d4f8792ccb326827daa5","name":"myMarkerC","value":[0,0],"blockId":"5c75d4f8792ccb326827daa1","parentId":null}],"count":1}}]}];
}


/*----------------------------------------------------------------------------*/

function featureEltId(featureBlock)
{
  let id = featurePathKeyFn(featureBlock);
  id = featureNameClass(id);
  return id;
}

function featurePathKeyFn (featureBlock)
{ return featureBlock._id.name; }

/** Given the grouped data for a feature, from the pathsDirect() result,
 * generate the cross-product feature.alignment[0].repeats X feature.alignment[1].repeats.
 * The result is an array of pairs of features;  each pair defines a path and is of type PathData.
 * for each pair an element of pairs[] :
 *   pair.feature0 is in block pair.block0
 *   pair.feature1 is in block pair.block1
 *   pair.block0 === feature.alignment[0].blockId
 *   pair.block1 === feature.alignment[1].blockId
 * i.e. the path goes from the first block in the request params to the 2nd block
 * @param feature 1 element of the result array passed to draw()
 * @return [PathData, ...]
 */
function pathsOfFeature(owner) {
  const PathData = owner.factoryFor('component:draw/path-data');
  return function (feature) {
    let blocksFeatures =
      [0, 1].map(function (blockIndex) { return feature.alignment[blockIndex].repeats.features; });
    let pairs = 
      blocksFeatures[0].reduce(function (result, f0) {
        let result1 = blocksFeatures[1].reduce(function (result, f1) {
          let pair =
            PathData.create({
              feature0 : f0,
              feature1 : f1,
              block0 : feature.alignment[0].blockId,
              block1 : feature.alignment[1].blockId
            });
          if (trace_blockAdj > 2)
            console.log('PathData.create()', PathData, pair);

          result.push(pair);
          return result;
        }, result);
        return result1;
      }, []);
    return pairs;
  };
}

function locationPairKeyFn(locationPair)
{
  return locationPair.feature0._id + '_' + locationPair.feature1._id;
}

/*----------------------------------------------------------------------------*/
