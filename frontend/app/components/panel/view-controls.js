import { next } from '@ember/runloop';
import { computed } from '@ember/object';
import { inject as service } from '@ember/service';
import Component from '@ember/component';

import {
  tabActive, inputRangeValue,
  expRangeBase, expRange, expRangeInitial
} from '../../utils/domElements';

import { toBool } from '../../utils/common/strings';

/* global d3 */

const dLog = console.debug;


export default Component.extend({
  tagName: 'div',
  // attributes
  // classes

  feed: service(),

  /*--------------------------------------------------------------------------*/
  /** paths are calculated in the backend if both blocks of block-adj are from
   * the same server;  otherwise they may be calculated in the frontend (client)
   * and / or in the backend via localiseBlocks().
  */
  pathJoinClient : false,
  pathJoinRemote : true,

  /*--------------------------------------------------------------------------*/

  /** Toggle axis-charts / Chart1 between showing the ChartLine-s as <rect> bars or lines   */
  chartBarLine : true,

  /*--------------------------------------------------------------------------*/

  /** time in milliseconds;   group events into discrete times.
   * Applies to various high-bandwidth events, e.g. axis-position : zoom,
   * axis-1d : updateAxis, draw/block-adj updatePathsPositionDebounced
   */
  debounceTime : 400,
  throttleTime : 40,

  /*--------------------------------------------------------------------------*/

  /** may be set via URL param - @see readParsedOptions(). */
  pathsViaStream : true,

  /** This slider value is mapped via an exponential (computed) function and
   * available as :
   * controls.view.pathControlActiveDensity
   *
   * Calculation of initial / default value :
   * Some explanation in see comment in @expRange()
   * and @see updateSbSizeThresh() (draw-map.js)
   */
  pathDensity : expRangeInitial(100, expRangeBase(100/2, 1000)),
  /** ditto, 
   * controls.view.pathControlActiveSample
   */
  pathSample : expRangeInitial(400, expRangeBase(100, 10000)),

  pathControlActiveDensity : computed('pathDensityActive', 'pathDensity', function () {
    let active = this.get('pathDensityActive'),
     pathDensity = +this.get('pathDensity'),
      density = active && expRange(pathDensity, 100/2, 1000);
    if (density) {
      let digits = Math.log10(density),
      decimals =  (digits > 2) ? 0 : ((digits > 1) ? 1 : 2);
      density = +density.toFixed(decimals);
    }
    let value = inputRangeValue('range-pathDensity');
    next(function () {
      let value2 = inputRangeValue('range-pathDensity');
      if (value !== value2)
        dLog('range-pathDensity',  value, value2);
    });

    dLog('pathControlActiveDensity', pathDensity, density);
    return density;
   }),

  pathControlActiveSample : computed('pathSampleActive', 'pathSample', function () {
    let active = this.get('pathSampleActive'),
     pathSample = +this.get('pathSample'),
     sample = active && expRange(pathSample, 100, 10000);
    if (sample) {
      sample = Math.round(sample);
    }
    let value = inputRangeValue('range-pathSample');
    next(function () {
      let value2 = inputRangeValue('range-pathSample');
      if (value !== value2)
        dLog('range-pathSample',  value, value2);
    });
    dLog('pathControlActiveSample', pathSample, sample);
    return sample;
   }),

  /** ditto, 
   * controls.view.pathControlActiveNFeatures
   */
  pathNFeatures : expRangeInitial(1000, expRangeBase(100, 10000)),

  pathControlNFeatures : computed('pathNFeatures', 'pathNFeatures', function () {
    /** May make nFeatures display and range slider sensitive only when
     * pathsViaStream, or perhaps it will be a limit applicable also to other
     * (non-streaming) request modes.
     */
    let active = this.get('pathsViaStream'),
     pathNFeatures = +this.get('pathNFeatures'),
     nFeatures = active && expRange(pathNFeatures, 100, 10000);
    if (nFeatures) {
      nFeatures = Math.round(nFeatures);
    }
    dLog('pathControlNFeatures', pathNFeatures, nFeatures);
    return nFeatures;
   }),

  pathsDensityParams : computed(
    'pathControlActiveSample', 'pathControlActiveDensity', 'pathControlNFeatures',
    function () {
      let params = {};

      let nSamples = this.get('pathControlActiveSample');
      if (nSamples) {
        params.nSamples = nSamples;
      }
      let densityFactor = this.get('pathControlActiveDensity');
      if (densityFactor) {
        params.densityFactor = densityFactor;
      }
      let nFeatures = this.get('pathControlNFeatures');
      if (nFeatures) {
        params.nFeatures = nFeatures;
      }
      return params;
    }),

  featuresCountsNBinsLinear : expRangeInitial(100, expRangeBase(100, 500)),

  featuresCountsNBins : computed('featuresCountsNBinsLinear', function () {
    let
     thresholdLinear = +this.get('featuresCountsNBinsLinear'),
     threshold = expRange(thresholdLinear, 100, 500);
    if (threshold) {
      threshold = Math.round(threshold);
    }
    dLog('featuresCountsNBins', thresholdLinear, threshold);
    return threshold;
   }),

  featuresCountsThresholdLinear : expRangeInitial(500, expRangeBase(100, 10000)),

  /** Threshold between showing featuresCounts charts and features tracks :
   *  - if (count <= featuresCountsThreshold) show features (axis-tracks)
   *  - if  (count > featuresCountsThreshold) show featuresCounts (axis-charts)
   */
  featuresCountsThreshold : computed('featuresCountsThresholdLinear', function () {
    let
     thresholdLinear = +this.get('featuresCountsThresholdLinear'),
     threshold = expRange(thresholdLinear, 100, 10000);
    if (threshold) {
      threshold = Math.round(threshold);
    }
    dLog('featuresCountsThreshold', thresholdLinear, threshold);
    return threshold;
   }),

  /*--------------------------------------------------------------------------*/

  didInsertElement() {
    dLog("components/draw-controls didInsertElement()", this.drawActions);
    this._super(...arguments);

    this.drawActions.trigger("drawControlsLife", true);
    // initially 'Paths - Sample' tab is active.
    // To change the initial active tab, change this and also change .active
    // class of .active-detail and .tab-pane, and .in class of the latter.
    this.send('pathTabActive', 'sample');
    this.readParsedOptions();
    this.set('controls.view', this);
  },
  readParsedOptions() {
    /** this can be passed in from model.params.parsedOptions and then access pathsViaStream as 
     * this.get('parsedOptions.pathsViaStream');
     */
    let parsedOptions = this.drawActions.model.params.parsedOptions;

    /** default to true if not given as URL query param e.g. options=pathsViaStream=false  */
    let pathsViaStream = parsedOptions && parsedOptions.pathsViaStream;
      // this.get('parsedOptions.pathsViaStream');
    if (pathsViaStream !== undefined)
      this.set('pathsViaStream', toBool(pathsViaStream));
  },
  willDestroyElement() {
    dLog("components/draw-controls willDestroyElement()");
    this.drawActions.trigger("drawControlsLife", false);
  },

  actions : {
    pathTabActive : function(tabName) {
      let active;
      active = tabName === 'density';
      dLog('pathDensityActive', active, tabName);
      this.set('pathDensityActive', active);

      active = tabName === 'sample';
      dLog('pathSampleActive', active);
      this.set('pathSampleActive', active);
    },

    flipRegion : function () {
      this.get('feed').trigger('flipRegion', undefined);
    },

    clearScaffoldColours  : function () {
      dLog("clearScaffoldColours", "selected-markers.js");
      this.get('feed').trigger('clearScaffoldColours');
    },

    resetZooms : function () {
      this.get('feed').trigger('resetZooms');
    },

  },

});
