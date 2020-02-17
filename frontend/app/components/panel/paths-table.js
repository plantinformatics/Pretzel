import Ember from 'ember';
const { inject: { service } } = Ember;


import PathData from '../draw/path-data';
import { pathsResultTypes, pathsApiResultType, pathsResultTypeFor, featureGetFn, featureGetBlock } from '../../utils/paths-api';


const dLog = console.debug;

const columnFields = ['block', 'feature', 'position'];


/**
 * Arguments passed to template :
 * @param selectedFeatures  catenation of features within all brushed regions
 * @param selectedBlock block selected via axis brush, or via click in dataset explorer or view panel, or adding the block.
 *
 * @desc inputs from template
 * @param blockColumn true means show the block name:scope in a column instead of as a row.
 */
export default Ember.Component.extend({
  flowsService: service('data/flows-collate'),
  pathsPro : service('data/paths-progressive'),
  axisBrush: service('data/axis-brush'),

  blockColumn : true,
  showDomains : false,

  classNames: ['paths-tables'],

  didReceiveAttrs() {
    this._super(...arguments);

    dLog('didReceiveAttrs', this.get('block.id'), this);
  },

  /*--------------------------------------------------------------------------*/

  actions: {

    selectionChanged: function(selA) {
      dLog("selectionChanged in components/panel/paths-table", selA);
      for (let i=0; i<selA.length; i++) {
        dLog(selA[i].feature, selA[i].position);
      }
    },
    requestAllPaths() {
      this.requestAllPaths();
    }
  },

  /*--------------------------------------------------------------------------*/

  selectedFeaturesByBlock : Ember.computed(
    'selectedFeatures.[]',
    function () {

    let selectedFeatures = this.get('selectedFeatures');
    /** map selectedFeatures to a hash by block (dataset name and scope).
     * selectedFeatures should be e.g. a WeakSet by feature id, not name.
     */
    let selectedFeaturesByBlock = selectedFeatures ?
      selectedFeatures.reduce(function(result, feature) {
        if (feature.Chromosome) {
          if (! result[feature.Chromosome])
            result[feature.Chromosome] = {};
          result[feature.Chromosome][feature.Feature] = feature;
        }
        return result;
      }, {}) : {};
      return selectedFeaturesByBlock;
    }),


  /*--------------------------------------------------------------------------*/

  /**
   * also in utils/paths-filter.js @see pathInDomain()
   */
  filterPaths(pathsResultField) {

    let selectedBlock = this.get('selectedBlock');
    let selectedFeaturesByBlock = this.get('selectedFeaturesByBlock');
    let axisBrush = this.get('axisBrush');
    /** true means show the block name:scope in a column instead of as a row. */
    let blockColumn = this.get('blockColumn');
    /** true means show the brushed domains in the table. This may be omitted, although it
     * seems important to know if the axis was brushed and what the region
     * was.  */
    let showDomains = this.get('showDomains');
    /** true means show counts of paths before and after filtering in the table.  */
    let showCounts = this.get('showCounts');


    if (false) {
    /**   form is e.g. : {Chromosome: "myMap:1A.1", Feature: "myMarkerA", Position: "0"} */
    let chrName = "", // e.g. "myMap:1A.1",
    position = "", // e.g. "12.3",
    result =
      {Chromosome: chrName, Feature: featureName, Position: position};
    }


    let
      blockAdjs = this.get('flowsService.blockAdjs'),
    tableData = blockAdjs.reduce(function (result, blockAdj) {
      // components/panel/manage-settings.js:14:        return feature.Block === selectedBlock.id
      if (! selectedBlock || blockAdj.adjacentTo(selectedBlock)) {
        /** Prepare a row with a pair of values to add to the table */
        function setEndpoint(row, i, block, feature, position) {
          if (block)
            row['block' + i] = block;
          row['feature' + i] = feature;
          row['position' + i] = position;
          return row;
        };
        let blocks = blockAdj.get('blocks'),
          blocksById = blocks.reduce((r, b) => { r[b.get('id')] = b; return r; }, {});
        let blockIndex = blockAdj.get('blockIndex');
        if (! blockColumn) {
          /** push the names of the 2 adjacent blocks, as an interleaved title row in the table. */
          let
          namesFlat = blocks.reduce(
            (rowHash, b, i) =>
              setEndpoint(rowHash, i, undefined, b.get('datasetId.id'), b.get('scope')), {});
          // blank row to separate from previous blockAdj
          result.push({'feature0': '_'});
          result.push(namesFlat);
        }
        if (showDomains) {
          /** Add to the table the brushed domain of the 2 blocks. */
          let brushedDomains = blocks.reduce((rowHash, b, i) => {
            let ab = axisBrush.brushOfBlock(b),
            brushedDomain = ab && ab.get('brushedDomain');
            if (brushedDomain) {
              setEndpoint(rowHash, i, undefined, brushedDomain[0], brushedDomain[1]);
            }
            return rowHash;
          }, {});
          result.push(brushedDomains);
        }

        let resultElts = blockAdj.get(pathsResultField);
        if (resultElts) {
        if (resultElts.length)
          if (showCounts)
            result.push(setEndpoint({}, 0, undefined, 'Paths loaded', resultElts.length));
          let outCount = 0;
          resultElts.forEach((resultElt) => {
            /** for each end of the path, if the endpoint is in a brushed block,
             * filter out if the endpoint is not in the (brushed)
             * selectedFeatures.
             */

            let
              pathsResultTypeName = pathsResultField.replace(/Filtered$/, ''),
              pathsResultType = pathsResultTypeFor(pathsResultTypeName, resultElt);


            /** accumulate names for table, not used if out is true. */
            let path = {};
            /** Check one endpoint of the given path resultElt
             * @param resultElt one row (path) of the paths result
             * @param i 0 or 1 to select either endpoint of the path resultElt
             * @param path  array to accumulate path endpoint details in text form for table output
             * @return true if the endpoint is in selectedFeatures, or its block is not brushed.
             */
            function filterOut(resultElt, i, path) {
              let
                blockId = pathsResultType.pathBlock(resultElt, i),
              /** each end may have multiple features - should generate the
               * cross-product as is done in block-adj.c : pathsOfFeature()
               */
              features = pathsResultType.blocksFeatures(resultElt, i),
              feature = features[0],
              featureGet = featureGetFn(feature),
              block = featureGetBlock(feature, blocksById),
              /** brushes are identified by the referenceBlock (axisName). */
              chrName = block.get('brushName'),
              selectedFeaturesOfBlock = selectedFeaturesByBlock[chrName],
              featureName = featureGet('name'),
              /** if the axis is brushed but there are no features in this block
               * within the brush, then selectedFeaturesOfBlock will be
               * undefined (empty).  If the axis is not brushed then no filter
               * is applied on this endpoint.
               */
              isBrushed = !!axisBrush.brushOfBlock(block),
              out = selectedFeaturesOfBlock ?
                /* endpoint feature is not in selectedFeaturesOfBlock */
                ! selectedFeaturesOfBlock[featureName]
                : isBrushed;
              if (! out) {
                let value = featureGet('value');
                let i = blockIndex.get(block);
                path['block' + i] = block.get('datasetNameAndScope');
                path['position' + i] = '' + value;
                path['feature' + i] = featureName;
              }
              return out;
            }
            let out = filterOut(resultElt, 0, path) || filterOut(resultElt, 1, path);
            if (! out) {
              result.push(path);
              outCount++;
            }
          });
          if (showCounts)
            result.push(setEndpoint({}, 0, undefined, 'Filtered Count', outCount));
        }
      }
      return result;
    }, []);

    dLog('filterPaths',  tableData, blockAdjs);
    return tableData;
  },

  tableData/*Aliases*/ : Ember.computed(
    'pathsResultFiltered.[]',
    'pathsAliasesResultFiltered.[]',
    'selectedBlock',
    'selectedFeaturesByBlock.@each',
    'blockColumn',
    'showDomains',
    'showCounts',
    function () {
      let tableDataAliases = this.filterPaths('pathsAliasesResultFiltered');
      dLog('tableDataAliases', tableDataAliases);
      let tableData = this.filterPaths('pathsResultFiltered');
      dLog('tableData', tableData);
      let data = 
        (tableDataAliases.length && tableData.length) ?
        tableDataAliases.concat(tableData)
        : (tableData.length ? tableData : tableDataAliases)
      ;
      return data;
    }),
  tableData_bak : Ember.computed(
    'pathsResult.[]',
    'selectedBlock',
    'selectedFeaturesByBlock.@each',
    'blockColumn',
    'showDomains',
    'showCounts',
    function () {
      let tableData = this.filterPaths('pathsResult');
      dLog('tableData', tableData);
      return tableData;
    }),

  csvExportData : Ember.computed('tableData', 'blockColumn', function () {
    let activeFields = columnFields.slice(this.get('blockColumn') ? 0 : 1);
    let headerRow =
    [0, 1].reduce(function (result, end) {
      activeFields.reduce(function (result, fieldName) {
        result.push('"' + fieldName + end + '"');
        return result;
      }, result);
      return result;
    }, []);
    dLog('csvExportData', headerRow);

    let data = this.get('tableData').map((d, i) => {
      let da =
      [0, 1].reduce(function (result, end) {
        activeFields.reduce(function (result, fieldName) {
          // if undefined, push '' for a blank cell.
          let v = d[fieldName + end],
          /** wrap text fields with double-quotes, and also position with comma - i.e. intervals 'from,to'.  */
          quote = (fieldName === 'block') || (fieldName === 'feature') || (v.indexOf(',') > -1),
          outVal = v ? ( quote ? '"' + v + '"' : v) : '';
          result.push(outVal);
          return result;
        }, result);
        return result;
      }, []);
      if (i === 0)
        dLog('csvExportData', d, da);
      return da;
    });
    data.unshift(headerRow);
    return data;
  }),

  /*--------------------------------------------------------------------------*/

  /** Send API request for the block-adj-s displayed in the table, with
   * fullDensity=true, i.e. not limited by GUI path densityFactor / nSamples /
   * nFeatures setings.
   */
  requestAllPaths() {
    dLog('requestAllPaths', this);

    let selectedBlock = this.get('selectedBlock');
    let loadingPromises = [];

    let pathsPro = this.get('pathsPro');
    pathsPro.set('fullDensity', true);

    let
      blockAdjs = this.get('flowsService.blockAdjs');
    blockAdjs.forEach(function (blockAdj) {
      if (! selectedBlock || blockAdj.adjacentTo(selectedBlock)) {
        let p = blockAdj.call_taskGetPaths();
        loadingPromises.push(p);
      }
    });
    pathsPro.set('fullDensity', false);

    /* set .loading true while API requests are in progress. */
    if (loadingPromises.length) {
      let all = Ember.RSVP.allSettled(loadingPromises);
      this.set('loading', true);
      all.then(() => this.set('loading', false));
    }

  },
  /*--------------------------------------------------------------------------*/

});
