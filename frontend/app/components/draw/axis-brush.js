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
const className = "axisBrush";
const CompName = 'components/axis-brush';

const trace_axisBrush = 1;
const dLog = console.debug;


/*----------------------------------------------------------------------------*/

/**
 * @param blockId
 * @param drawMap for Evented - stack events
 */
export default Ember.Component.extend(Ember.Evented, AxisEvents, {
  /** AxisEvents is used to receive axis stacking and resize events.
   *  Evented may be used in future to propagate events to components rendered within axis-brush.
   */
  store: service(),
  pathsP : service('data/paths-progressive'),

  zoomCounter : 0,

  axisBrush : Ember.computed('block', function () {
    let
      block = this.get('block'),
    /** axis-brush object in store */
    record = this.get('pathsP').ensureAxisBrush(block);
    if (trace_axisBrush)
      dLog('block', block.id, block, record);
    return record;
  }),

  blockId : Ember.computed.alias('block.id'),

  /** Result is, for blockID,  the axis on which the block is displayed.
   * Will need to add dependency on stacks component, because block can be un-viewed then re-viewed.
   */
  axis :  Ember.computed('blockId', function () {
    let
      blockId = this.get('blockId'),
    axis = Stacked.getAxis(blockId);
    console.log('axis', axis);
    return axis;
  }),

  features : Ember.computed('axisBrush.features.[]', 'zoomCounter', function () {
    console.log('features', this);
    let featuresP = this.get('axisBrush.features');
    featuresP.then((features) => {
    if (features && features.length)
      throttle(this, this.draw, features, 200, false);
    });
    return featuresP;
  }),

  /*--------------------------------------------------------------------------*/

  isAxis(axisID) {
    let axis = this.get('axis'),
    match = (axis.axisName === axisID);
    return match;
  },

  /*--------------------------------------------------------------------------*/


  /**
   * @param features
   */
  draw (features) {
    if (features.length === 0)
      return;

    let axisApi = this.get('drawMap.oa.axisApi');
    dLog('draw', this, features.length, axisApi);
    if (axisApi) {
      let
        /** defined after first brushHelper() call. */
        axisFeatureCirclesBrushed = axisApi.axisFeatureCirclesBrushed;
      if (axisFeatureCirclesBrushed)
        axisFeatureCirclesBrushed();
    }

  },

  /** Update the cx and cy attributes of the <circle>-s.  */
  updateFeaturesPosition() {
  },

  /*--------------------------------------------------------------------------*/

  updateFeaturesPositionDebounce(axisID_t) {
    // console.log('updateFeaturesPositionDebounce', axisID_t);
    Ember.run.debounce(this, this.updateFeaturesPosition, axisID_t, 500);
  },

  /*--------------------------------------------------------------------------*/
  
  /** axis-brush receives axisStackChanged and zoomedAxis from draw-map
   */

  resized : function(widthChanged, heightChanged, useTransition) {
    if (trace_axisBrush > 1)
      dLog("resized in ", CompName);
    if (heightChanged)
      // instead of debounce, can trigger position update with this.incrementProperty('rangeCounter');
      this.updateFeaturesPositionDebounce();
  },

  axisStackChanged : function() {
    if (trace_axisBrush > 1)
      dLog("axisStackChanged in ", CompName);
    this.updateFeaturesPositionDebounce();
  },

  /** @param [axisID, t] */
  zoomedAxis : function(axisID_t) {
    let axisID = axisID_t[0],
    blockId = this.get('blockId'),
    axis = this.get('axis');
    if (trace_axisBrush > 1)
      console.log("zoomedAxis in ", CompName, axisID_t, blockId, axis);
    if (this.isAxis(axisID))
    {
      if (trace_axisBrush > 1)
        dLog('zoomedAxis matched', axisID, blockId, axis);
      this.incrementProperty('zoomCounter');
    }
  }
  /*--------------------------------------------------------------------------*/

  
});


/*----------------------------------------------------------------------------*/

function featureEltId(featureBlock)
{
  let id = featureKeyFn(featureBlock);
  id = featureNameClass(id);
  return id;
}


function featureKeyFn (featureBlock)
{ return featureBlock._id.name; }



/*----------------------------------------------------------------------------*/
