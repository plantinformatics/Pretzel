import { getOwner } from '@ember/application';
import { allSettled, Promise } from 'rsvp';
import { A } from '@ember/array';
import { computed, get } from '@ember/object';
import { alias } from '@ember/object/computed';
import Evented from '@ember/object/evented';
import Component from '@ember/component';
import { inject as service } from '@ember/service';
import { throttle, later, next } from '@ember/runloop';
import { task } from 'ember-concurrency';


import AxisEvents from '../../utils/draw/axis-events';
import { stacks, Stacked } from '../../utils/stacks';
import {
  selectAxis,
  blockAdjKeyFn,
  blockAdjEltId,
  featureEltIdPrefix,
  featureNameClass,
  foregroundSelector,
  selectBlockAdj
} from '../../utils/draw/stacksAxes';
import {
  targetNPaths,
  pathsFilter,
  pathsFilterSmooth
} from '../../utils/draw/paths-filter';
import { intervalSize } from  '../../utils/interval-calcs';
import {
  pathsResultTypes,
  pathsApiResultType,
  flowNames,
  resultBlockIds,
  pathsOfFeature,
  locationPairKeyFn
} from '../../utils/paths-api';

/* global d3 */



/*----------------------------------------------------------------------------*/

/** Used for CSS selectors targeting <g> and <path>-s generated by this component. */
const className = "blockAdj";
const CompName = 'components/axis-ticks-selected';

const trace_blockAdj = 0;
const dLog = console.debug;

/*----------------------------------------------------------------------------*/
/* milliseconds duration of transitions in which alignment <path>-s between
 * features are drawn / changed, in particular the d attribute.
 * Match with time used by draw-map.js : zoom() and resetZoom() : 750.
 * also @see   dragTransitionTime and axisTickTransitionTime.
 * @see featureTrackTransitionTime
 */
const pathTransitionTime = 750;

/** Used for d3 attribute functions - return the datum of the element. */
function datumIdent(d) { return d; }

/** select the g.direct and g.alias within g.foreground > g.progress.
 * @see flowNames[]
 * @param flowName  undefined, or an element of flowNames[]
 */
function progressGroupsSelect(flowName) {
  /** if flowName is undefined, then select g.direct and g.alias.  refn flowNames[] */
  let classSelector = flowName ? '.' + flowName : '',
  selector = foregroundSelector + '> g.progress > g' + classSelector,
  g = d3.selectAll(selector);
  return g;
}

/** if value is a promise then call fn(value) when the promise resolves, otherwise call it now.
 * @return a promise, yielding fn(value), if value is a promise, otherwise fn(value)
 */
function thenOrNow(value, fn) {
  let result;
  if (value.then) {
    result = value.then(fn);
  }
  else {
    result = fn(value);
  };
  return result;
}


/*----------------------------------------------------------------------------*/

/**
 * @param blockAdj  [blockId0, blockId1]
 * @param drawMap for Evented - stack events
 */
export default Component.extend(Evented, AxisEvents, {
  /** AxisEvents is used to receive axis stacking and resize events.
   *  Evented may be used in future to propagate events to components rendered within block-adj.
   */
  store: service(),
  pathsP : service('data/paths-progressive'),
  flowsService: service('data/flows-collate'),
  block: service('data/block'),
  queryParams: service('query-params'),


  needs: ['component:draw/path-data'],

  /** counters to debounce CFs */
  heightChanged : 0,
  axisStackChangedCount : 0,

  /** The DB IDs of the blocks which this block-adj aligns.
      * array[2] of blockId
      */
  blockAdjId : alias('blockAdj.blockAdjId'),
  // blockAdj.id is the same values in a string form, separated by '_'
/*  ('blockAdj', function () {
    let blockAdj = this.get('blockAdj'),
    blockAdjId = blockAdj.get('blockAdjId');
    dLog(blockAdj, 'blockAdjId', blockAdjId);
    return blockAdjId;
  }),
*/
  axes :  alias('blockAdj.axes'),

  /** comment in services/data/block.js explains context of urlOptions
   */
  parsedOptions : alias('queryParams.urlOptions'),

  pathsDensityParams : alias('pathsP.pathsDensityParams'),
  pathsResultLength : computed(
    'blockAdj.pathsResult.[]', 'pathsAliasesResultLength',
    'pathsDensityParams.{densityFactor,nSamples,nFeatures}',
    function () {
    let
    length = this.drawCurrent(pathsResultTypes.direct),
    pathsAliasesLength = this.get('pathsAliasesResultLength');
    return length;
  }),
  /** Used in paths{,Aliases}ResultLength().
   */
  drawCurrent : function(prType) {
    let
    /** e.g. 'pathsResult' or 'pathsAliasesResult'
     * Use the filtered form of the API result.
     */
    pathsResult = this.get('blockAdj.' + prType.fieldName + 'Filtered'),
    fnName = prType.fieldName + 'Length',
    length = pathsResult && pathsResult.length;
    dLog(fnName, this, length);
    if (length) {
      let pathsDensityParams = this.get('pathsDensityParams'),
      axes = this.get('axes'),
      // axesDomains = this.get('blockAdj.axesDomains'),
      // Use the current zoom domain, not the overall domain, which is b.axis.domain.
      blockDomains =
        axes.mapBy('blocks')
        .reduce(function (bd, bb) {
          // if b.axis.axis1d.get('zoomed') is false, then domain will be undefined.
          // also b.axis.axis1d can be undefined, probably because of new axis, in which case it won't be zoomed yet (except when we add zoom domain to the URL).
          // if axis is deleted, blocks are un-viewed, i.e. b.block.get('isViewed') is false, and b.axis === undefined
          bb.forEach(function (b) { bd[b.axisName] = b.axis && b.axis.axis1d && b.axis.axis1d.get('domain'); }); return bd; }, {}),
      axesRanges = axes.map((a) => a.yRange()),
      axisLengthPx = Math.max.apply(null, axesRanges),
      nPaths = targetNPaths(pathsDensityParams, axisLengthPx);
      // handle b.axis === undefined (block has been un-viewed)
      if (Object.values(blockDomains).indexOf(undefined) !== -1) {
        return 0;
      }
      if (pathsResult.length < nPaths) {
        /* to satisfy the required nPaths, trigger a new request. */
        this.incrementProperty('blockAdj.pathsRequestCount');
      } else if (pathsResult.length > nPaths) {
        /** Filtering should be smooth, so filtering paths for render keeps the
         * currently-drawn paths where possible, instead of choosing paths for
         * each render independently.
         * When zooming in, retain the paths which are currently drawn and add
         * more as needed; when zooming out, filter the current paths according
         * to the reduction of zoomedDomain, and add new paths in the region
         * (previousDomain - new domain), to meet the desired number.
         */
        let
          scope = this.get('scope' + prType.typeName),
        currentScope = {blockDomains, pathsDensityParams, nPaths};
        if (! scope) {
          /* first call, scope is not yet defined, there are no existing paths,
           * so use pathsFilter() instead of pathsFilterSmooth() */
          pathsResult = pathsFilter(prType, pathsResult, blockDomains, nPaths);
          scope = this.set('scope' + prType.typeName, A());
          scope[0] = currentScope;
          let shown = this.set('shown' + prType.typeName, new Set());
          pathsResult.forEach((p) => shown.add(p));
        } else {
          let shown = this.get('shown' + prType.typeName);
          scope[1] = currentScope;
          pathsResult = pathsFilterSmooth(prType, pathsResult, scope, shown);
          scope.removeAt(0);
        }
      }
      /* The calling CPs paths{,Aliases}ResultLength() are called before didRender
       * and hence before drawGroup{,Container}().   .draw() uses the <g>-s they
       * maintain, so defer until end of run loop.
       */
      later( () => 
                       this.draw(/*pathsApiResultType*/ prType, pathsResult)
                     );
    }

    return length;
  },
  pathsAliasesResultLength : computed(
    'blockAdj.pathsAliasesResult.[]', 'paths.alias.[]',
    'pathsDensityParams.{densityFactor,nSamples,nFeatures}',
    function () {
    /* pathsAliasesResult is in a different form to pathsResult; passing it to
     * draw() requires some mapping, which is abstracted in 
     * pathsResultType e.g. pathsResultTypes.{direct,alias}
     */
    pathsApiResultType.flowName = pathsResultTypes.alias.flowName;
    pathsApiResultType.fieldName = pathsResultTypes.alias.fieldName;

    let
    pathsAliasesLength = this.drawCurrent(pathsApiResultType /*pathsResultTypes.alias*/);

    return pathsAliasesLength;
  }),
  paths : alias('blockAdj.paths'),
  /** Trigger paths request - side-effect. In the streaming case, result when
   * the stream ends is [], so paths{,Aliases}Result are used instead of the
   * result of this promise.
   */
  pathsRequest : computed('blockAdj.paths', function () {
    let pathsP = this.get('blockAdj.paths');
    dLog('blockAdj.paths', pathsP);
    function thenLength(p) { return ! p ? 0 : thenOrNow(p, (a) => get(a, 'length')); }
    let lengthSumP = thenLength(pathsP.direct) + thenLength(pathsP.alias);
    return lengthSumP;
  }),
  /** Draw all new paths received - unfiltered by pathsDensityParams.
   * The above paths{,Aliases}ResultLength(), which are currently used, ensure
   * the required renders, so this can be dropped if there is not likely to be a
   * need for showing unfiltered paths.
   */
  pathsEffect : computed(
    // the debugger will evaluate this CP if this dependency is enabled.
    // 'blockAdj.paths.{direct,alias}.[]',
    function () {
    /** in the case of pathsViaStream, this promise will resolve with [] instead of the result -
     * blockAdj.pathsResult is passed to draw() instead.  */
    let pathsP = this.get('blockAdj.paths');
    dLog('blockAdj.paths', pathsP);
    thenOrNow(pathsP, (result) => {
      dLog('blockAdj.paths', result);
      flowNames.forEach(flowName => {
        if (result[flowName])
          thenOrNow(result[flowName], (paths) => {
            /** pathsApiResultType could be identified as
             * pathsResultTypes.pathsApi; it is an input format which may be used
             * in multiple flows, so possibly .flowName should be separate from
             * pathsResultTypes[].
             */
            let pathsResultType = paths.length && paths[0].featureAObj ?
              pathsApiResultType /*pathsResultTypes.pathsApi*/ : pathsResultTypes[flowName];
            dLog('blockAdj.paths length', paths && paths.length, pathsResultType);
            if (paths && paths.length)
              throttle(this, this.draw, pathsResultType, paths, 200, false);
          });
      });
    });

    if (false) {
    /** .direct and.alias are defined by the result of pathsP, not by pathsP, so
     * this would need to change; no purpose for this yet. */
    let resultP = (pathsP.direct && pathsP.alias) ?
    allSettled([pathsP.direct, pathsP.alias])
      : (pathsP.direct || pathsP.alias);
    }
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
    let pM = this.drawGroupContainer();
    this.drawGroup(pM, true);
  },

  willDestroyElement() {
    // didDestroyElement() would also be OK
    dLog('willDestroyElement', this.get('blockAdjId'));
    let foreground = d3.selectAll(foregroundSelector);
    let pS = foreground
      // delete both g.direct and g.alias
      .selectAll('g > g.progress > g');
    this.drawGroup(pS, false);

    this._super(...arguments);
  },

  /** Give the flow control a handle of the g.progress > g for each flow, so
   * that flow-controls : action toggleVisible -> showVisible() can toggle
   * .hidden on this <g>.
   */
  connectFlowControl(flowName, g) {
    let flowsService = this.get('flowsService'),
    flows = flowsService.get('flows');
    dLog('connectFlowControl', flows, flows[flowName].g, g);
    flows[flowName].g = g;
  },

  /** Render the <g.progress><g.direct> which contains the <g.blockAdj> <g> <path>
   * rendered by this component. */
  drawGroupContainer() {
    let foreground = d3.selectAll(foregroundSelector);
    let ppS = foreground
      .selectAll('g > g.progress')
      .data([1]),
    ppA = ppS
      .enter()
      .append('g')
      .attr('class', 'progress'),
    ppM = ppS.merge(ppA),

    pS = ppM
      .selectAll('g > g.direct, g > g.alias') // @see flowNames[]
      .data(flowNames),
    me = this,
    pA = pS
      .enter()
      .append('g')
      .attr('class', datumIdent)
      .each(function (d, i, g) { dLog(this); me.connectFlowControl(d, d3.select(this)); } ),
    pM = pS.merge(pA);
    if (trace_blockAdj)
      dLog('drawGroupContainer', pS.nodes(), pS.node());
    return pM;
  },
  /** Render the <g.blockAdj> which contains the <g><path>
   * @param pM  selection within which to append <g>; result of drawGroupContainer().
   * @param add  true to draw, false to remove
   */
  drawGroup(pM, add) {

    /* render the <g> for this block-adj */
    let
      blockAdjId = this.get('blockAdjId');

    let groupAddedClass = 'block-adj';
    let id = blockAdjEltId(blockAdjId);
    let gS = pM.selectAll('g' + '#' + id + '.' + className + '.' + groupAddedClass);
    /* could use .data(), given a list of all block adjacencies :
     * .data(flowsService.blockAdjs, blockAdjKeyFn); ... gS.enter() ... */
    if (add && gS.empty()) {
      let gA = pM
        .append('g')
        .datum(blockAdjId)
        .attr('id', blockAdjEltId)
        .attr('class', className + ' ' + groupAddedClass)
      ;
      dLog(gA.nodes(), gA.node(), this);
    }
    else if (! add && ! gS.empty()) {
      dLog('drawGroup remove', gS.nodes(), gS.node(), this);
      gS.remove();
    }
      
  },


  /**
   * @param pathsResultType e.g. pathsResultTypes.{Direct,Aliases}
   * @param paths grouped by features
   */
  draw (pathsResultType, featurePaths) {
    if (featurePaths.length === 0)
      return;
    pathsResultType.typeCheck(featurePaths[0], true);
    let store = this.get('store');
    /* Enables (via ?options=pathRemoveTransition), animation of <path> removal
     * which is useful to verify paths re-filter.
     * If it was enabled in the general release, the transition can include
     * d=pathU so that paths removed at the edge, when zooming in, move over the
     * edge.
     */
    let pathRemoveTransition = this.get('parsedOptions.pathRemoveTransition');

    /** blockAdjId is also contained in the result featurePaths
     */
    let
      blockAdjId = this.get('blockAdjId');

    /** Looking at just the first result, check the results blockIds match the
     * request blockAdjId. */
    let blockIds = resultBlockIds(pathsResultType, featurePaths[0]);
    if (blockIds.length) {
      /** blockAdjId is the order of Stacked / axes, whereas
       * featurePaths[0].alignment is in request order.
       * Requests (so far) are asymmetric, so blockAdjId[] and blockIds[] may be
       * in opposite order.
       */
      // const reversed = blockAdjId[0] > blockAdjId[1],
      function match(reversed) {
        let
          ok = (blockIds[0] === blockAdjId[0+reversed]) && (blockIds[1] === blockAdjId[1-reversed]);
        return ok;
      }
      let ok = match(false) || match(true);
      if (! ok)
        dLog('draw verify', blockAdjId, blockIds);
    }

    // let axisApi = this.get('drawMap.oa.axisApi');
    if (trace_blockAdj) {
      blockAdjId.forEach(function (blockId) {
        let axis = Stacked.getAxis(blockId);
        let aS = selectAxis(axis);
        dLog(blockId, aS.node());
      });
    }

    let dpS = progressGroupsSelect(pathsResultType.flowName);

    let baS = selectBlockAdj(dpS, blockAdjId);
    dLog(baS.nodes(), baS.node());
    
    if (baS.empty())
      dLog('draw', blockAdjId);
    else
    {
      let gS = baS.selectAll("g." + className)
        .data(featurePaths, pathsResultType.featurePathKeyFn);
      if (pathRemoveTransition) {
        gS.exit()
          .call(gPathDashAndRemove);
      } else {
        gS.exit().remove();
      }

      let gA = gS.enter()
        .append('g')
        .attr('id', featureGroupIdFn) 
        .attr('class', className)
      ;
      function featureGroupIdFn(featurePath) {
        let id = resultBlockIds(pathsResultType, featurePath);
        return blockAdjEltId(id) + '_' + pathsResultType.featureEltId(featurePath);
      }


      let gSA = gS.merge(gA),
      owner = getOwner(this),
      pS = gSA
        .selectAll("path." + className)
        .data(pathsOfFeature(store, pathsResultType, owner), locationPairKeyFn),
      pSE = pS.enter()
        .append("path")
        .attr("class", className)
      ;
      let pSA = pS.merge(pSE);

      /** existing paths (pS) are transitioned from their previous position;
       * the previous position of added paths is not easily available so they
       * are drawn without transition at their new position; this is done after
       * the transition of the paths already shown, so that the transformation
       * is consistent at any point in time, otherwise the movement is
       * confusing.
       */
      let positionNew = () => this.get('pathPosition').perform(pSE)
        .catch((error) => dLog('pathPosition New', error));
      this.get('pathPosition').perform(pS, positionNew);

      // setupMouseHover(pSE);
      pS.exit().remove();
    }

  },

  /** Update the "d" attribute of the <path>-s.  */
  updatePathsPosition() {
    // based on draw().
    let dpS = progressGroupsSelect(undefined);
    let blockAdjId = this.get('blockAdjId');
    if (trace_blockAdj > 1)
      blockAdjId.forEach(function (blockId) {
        let axis = Stacked.getAxis(blockId);
        let y = stacks.oa.y[axis.axisName];
        dLog('updatePathsPosition axis', axis.axisName, y.domain(), axis, y.domain());
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
        dLog('updatePathsPosition removed', removed.nodes(), removed.node());
    removed.remove();
    pS = gS
      .selectAll("path." + className)
      // don't call pathU() if axes are gone.
      .filter(function (d) { return d.blocksHaveAxes(); });
    if (! pS.empty() && trace_blockAdj)
      dLog('updatePathsPosition before update pS', (trace_blockAdj > 1) ? pS.nodes() : pS.size(), pS.node());
    this.get('pathPosition').perform(pS, undefined);
  },

  /** Update position of the paths indicated by the selection.
   * Making this a task with .drop() enables avoiding conflicting transitions.
   * If thenFn is given, call it after transition is ended.
   * @param pathSelection
   * @param thenFn
   */
  pathPosition: task(function * (pathSelection, thenFn) {
    let
    /* now that paths are within <g.block-adj>, path position can be altered
     * during dragging by updating a skew transform of <g.block-adj>, instead of
     * repeatedly recalculating pathU.
     */
      transition = 
    pathSelection
      .transition().duration(pathTransitionTime)
      // pathU() is temporarily a function, will revert to a computed function, as commented in path().
      .attr("d", function(d) { return d.pathU() /*get('pathU')*/; });

    /** in a later version of d3, can use 
     * transitionEnd = transition.end(); ... return transitionEnd;
     * instead of new Promise(...)
     * The caller is interested in avoiding overlapped transitions, so
     * resolve/reject are treated the same.
     */
     let transitionEnd =  new Promise(function(resolve, reject){
       transition
         .on('end', (d) => resolve(d))
         .on('interrupt', (d, i, g) => {
           resolve(d);
           if (trace_blockAdj > 2) {
             dLog('interrupt', d, i, g); }; }); });  // also 'cancel', when version update
    if (trace_blockAdj) {
      dLog('pathPosition', pathSelection.node());
      transitionEnd.then(() => dLog('pathPosition end', pathSelection.node()));
    }
    /* instead of a callback, it should be possible to yield transitionEnd, and
     * the caller can .finally() on the task handle. Can retry this after version update. */
    if (thenFn)
      transitionEnd.then(thenFn);
  }).keepLatest(),

  /** Call updateAxis() for the axes which bound this block-adj.
   * See comment in updatePathsPositionDebounce().
   */
  updateAxesScale() {
    let
      axes = this.get('axes'),
    /** reference blocks */
    axesBlocks = axes.mapBy('blocks');
    dLog('updateAxesScale', axesBlocks.map((blocks) => blocks.mapBy('axisName')));
    axesBlocks.forEach(function (blocks) {
      blocks[0].axis.axis1d.updateAxis();
    });
  },

  /*--------------------------------------------------------------------------*/

  axesDomains : alias('blockAdj.axesDomains'),
  /** call updatePathsPosition().
   * filter / debounce the calls to handle multiple events at the same time.
   */
  updatePathsPositionDebounce : computed(
    'widthChanged',
    'heightChanged', 'axisStackChangedCount',
    // stacksWidthChanges depends on stacksCount, so this dependency is implied anyway.
    'block.stacksCount',
    'drawMap.stacksWidthChanges',
    'blockAdj.axes1d.0.flipRegionCounter',
    'blockAdj.axes1d.1.flipRegionCounter',
    /* Paths end X position is affected when an adjacent axis opens/closes (split).  */
    'blockAdj.axes1d.{0,1}.extended',
    /* will change scaleChanged to return {range: [from,to], domain : [from, to]}
     * currently it returns the scale function itself which is not usable as a dependent key.
     * Then the dependency can be : 'blockAdj.axes1d.{0,1}.scaleChanged.range.{0,1}'
     * After domain change, the available paths should be filtered again, whereas
     * after range change, it is sufficient to update the position of those paths already rendered.
     */
    'blockAdj.axes1d.0.scaleChanged',
    'blockAdj.axes1d.1.scaleChanged',
    'blockAdj.axes1d.{0,1}.axis2d.allocatedWidthsMax',
    function () {
    let count = this.get('axisStackChangedCount'),
      stacksWidthChanges = this.get('drawMap.stacksWidthChanges'),
      flips = [this.get('blockAdj.axes1d.0.flipRegionCounter'),
               this.get('blockAdj.axes1d.1.flipRegionCounter')],
      scaleChanges = [this.get('blockAdj.axes1d.0.scaleChanged'),
                      this.get('blockAdj.axes1d.1.scaleChanged')],
      zoomCounter = this.get('blockAdj.zoomCounter'),
      heightChanged = this.get('heightChanged');
      if (trace_blockAdj)
        dLog('updatePathsPositionDebounce', this.get('blockAdjId'), heightChanged, count, flips, zoomCounter, scaleChanges,
           stacksWidthChanges,
           this.get('block.stacksCount'));
    this.updatePathsPosition();
    /* redraw after axis extended width has updated. */
    later(() => this.updatePathsPosition(), 500);

      /* this update is an alternative trigger for updating the axes ticks and
       * scale when their domains change, e.g. when loaded features extend a
       * block's domain.  The solution used instead is the ComputedProperty
       * side-effect axis-1d : domainChanged(), which is a similar approach, but
       * it localises the dependencies to a single axis whereas this would
       * duplicate updates.  */
    // this.updateAxesScale();
    return count;
  }),


  /*--------------------------------------------------------------------------*/
  
  /** block-adj receives axisStackChanged and zoomedAxis from draw-map
   */

  resized : function(widthChanged, heightChanged, useTransition) {
    /* useTransition could be passed down to draw()
     * (also could pass in duration or t from showResize()).
     */
    if (trace_blockAdj > 1)
      dLog("resized in components/block-adj");
    /* In addition to the usual causes of repeated events, block-adj will
     * respond to events relating to 2 axes. */
    if (widthChanged)
      this.incrementProperty('widthChanged');
    if (heightChanged)
      this.incrementProperty('heightChanged');
  },

  axisStackChanged : function() {
    dLog("axisStackChanged in components/block-adj");
    // currently need time for x scale update
    next(() => ! this.isDestroying && this.incrementProperty('axisStackChangedCount'));
  },

  /** @param [axisID, t] */
  zoomedAxis : function(axisID_t) {
    let axisID = axisID_t[0],
    blockAdjId = this.get('blockAdjId'),
    axes = this.get('axes');
    if (trace_blockAdj > 1)
      dLog("zoomedAxis in ", CompName, axisID_t, blockAdjId, axes);
    /* zoomedAxis is specific to an axisID, so respond to that if
     * blockAdjId[0] or blockAdjId[1] are on this.axis.
     * resetZooms() does resetZoom(undefined) meaning un-zoom all axes, so match
     * if axisID is undefined.
     */
    if (!axisID || this.isAdjacentToAxis(axisID))
    {
      dLog('zoomedAxis matched', axisID, blockAdjId, axes);
      // paths positions are updated by event axisStackChanged() already received.
      // With zoom, the densityCount() result changes so request paths again
      this.incrementProperty('blockAdj.zoomCounter');
    }
  }
  /*--------------------------------------------------------------------------*/

  
}); // end of Component draw/block-adj


/*----------------------------------------------------------------------------*/

/** Transition the paths in the given g, to show that they are being removed.
 * @param g <g.blockAdj> which is to be removed, and contains <path.blockAdj>-s
 */
function gPathDashAndRemove(g) {
  /** selector 'path' is equivalent here to : 'g.blockAdj > path.blockAdj' */
  let exitPaths = g
    .transition().duration(pathTransitionTime * 3)
    .on('end', function() { d3.select(this).remove(); })
    .selectAll('path')
    .call(pathDashTween(true));
}

/* transition the stroke-dasharray, to show paths being added and removed. */

/* This could also be used on path exit,   e.g. :
 * pS.exit()
 *      .transition().duration(pathTransitionTime)
 *      .call(pathDashTween(true))
 *      .each("end", function() { d3.select(this).remove(); });
 * but generally this remove will not be reached because the parent <g> is
 * removed, and the transition is already applied on the gS.exit().
 *
 * This transition could also be applied on path append :
 *   pSE
 *     .transition().duration(pathTransitionTime * 3)
 *     .attr("d", function(d) { return d.pathU(); })
 *     .call(pathTween(false))
 *     .each("end", function() { d3.select(this).attr("stroke-dasharray", 'none'); });
 * pSE would have to be separated out of transition on pSA, to avoid conflict.
 */

/** Return a function which interpolates stroke-dasharray,
 * to show a path going from visible to invible (if out is true) or vice versa.
 */
function pathDashTween(out) {
  function tweenDash() {
    /* based on example https://bl.ocks.org/mbostock/5649592 */
    /** if length is not yet known, use 20px, otherwise 1/20 of length. */
    var l = (this.getTotalLength() / 20) || 20,
    dashStrings = [
      l + "," + 0,          // visible
      "0," + l + l/4],      // invisible
    from = dashStrings[+ !out],
    to = dashStrings[+ out],
    i = d3.interpolateString(from, to);
    return function(t) { return i(t); };
  }

  return function (path) {
  path
      .attrTween("stroke-dasharray", tweenDash);
  };
}



/*----------------------------------------------------------------------------*/
