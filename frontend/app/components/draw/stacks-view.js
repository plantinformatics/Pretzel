import Ember from 'ember';
const { inject: { service } } = Ember;

import { /* Block, Stacked, Stack,*/ stacks /*, xScaleExtend, axisRedrawText, axisId2Name*/ } from '../../utils/stacks';

/* global d3 */

const dLog = console.debug;

function blockInfo(block) { return block && [block.id, block.store.name, block.get('_internalModel.__data'), block.get('isCopy'), block.get('meta.origin')]; };

export default Ember.Component.extend({
  block: service('data/block'),
  previous : {},

  /** Extract from viewedBlocksByReferenceAndScope(), the viewed blocks, mapped by the id of their reference block.
   */
  axesBlocks : Ember.computed(
    /* viewedBlocksByReferenceAndScope is a Map, and there is not currently a way to
     * depend on Map.@each, so depend on blockValues.[], which
     * viewedBlocksByReferenceAndScope and blocksByReferenceAndScope depend on,
     * and viewed.[] which viewedBlocksByReferenceAndScope depends on.
     * (same applies in @see viewedBlocksByReferenceAndScope()
     * It is possible that this could be called after a change in viewed, but
     * before viewedBlocksByReferenceAndScope is updated; if this is a problem
     * an update counter could be used as a dependency.
     */
    'block.viewedBlocksByReferenceAndScope.@each', 'blockValues.[]', 'viewed.[]',
    function () {
    let mapByDataset = this.get('block.viewedBlocksByReferenceAndScope');
    let mapByReferenceBlock = {};
    if (mapByDataset)
      for (var [referenceName, mapByScope] of mapByDataset) {
        for (var [scope, blocks] of mapByScope) {
          /**  referenceBlock, undefined if the currently connected servers do
           *  not have a parent matching the child dataset's .parentName */
          if (blocks[0]) {
            mapByReferenceBlock[blocks[0].id] = blocks;
            if (true /*trace*/ )
              dLog('axesBlocks', referenceName, scope, blocks.mapBy('_internalModel.__data'));
          }
        }
      }
    dLog('axesBlocks', mapByDataset, mapByReferenceBlock);
    return mapByReferenceBlock;
  }),

  /** Map the keys (blockId) of axesBlocks to the primary or reference block of each axis.
   * @return  array of blocks (store Object)
   */
  axesP : Ember.computed('axesBlocks.@each', 'viewed.[]', function () {
    let axesBlocks = this.get('axesBlocks'),
    axisIDs = Object.keys(axesBlocks),
    axesP = axisIDs.map((axisID) => {
      let blocks = axesBlocks[axisID],
      block;
      if (blocks.length === 1)
        block = blocks[0];
      else if (blocks.length > 1) {
        let original = blocks.filter((b) => !b.get('isCopy'));
        if (original.length) {
          block = original[0];
          if (original.length > 1)  // not expected to happen
            dLog('axesP', axisID, 'choosing [0] from', original.map(blockInfo));
        }
        else {
          dLog('axesP', axisID, 'no original, choosing [0] from', blocks.map(blockInfo));
          block = blocks[0];
        }
      }
      return block;
    });
    dLog('axesP2', axesP, axisIDs);
    return axesP;
  }),

  stacksCount : Ember.computed('block.stacksCount', 'block.viewed', 'axes2d.[]', 'axesP.length', function () {
    let count;
    let previous = this.get('previous.stacks');
    let axesP = this.get('axesP');
    count = this.get('block.stacksCount');
    dLog('stacks', count, stacks);
    dLog(stacks, stacks.axesPCount, 'stacksCount', stacks.stacksCount);
    if (count != previous) {    // may not be needed
      this.set('previous.stacks', count);
      Ember.run.later(function () {
        stacks.oa.showResize(true, false); });
      this.get('drawMap').draw({}, 'dataReceived');
      stacks.oa.axisApi.stacksAxesDomVerify();
    }
    return count;
  }),

  /** @return blocks which correspond to axes, i.e. are not child blocks.  */
  axesP_unused : Ember.computed('block.viewed', function () {
    let blockService = this.get('block');
    let viewedBlocks = blockService.get('viewed');
    // dLog('viewedBlocks', viewedBlocks);
    let axesP = viewedBlocks.filter(function (block) {
      let blockId = block.get('id'),
      referenceBlock = block.get('referenceBlock');
      dLog('axesP', block, blockId, referenceBlock && referenceBlock.get('id'));
      return referenceBlock === undefined;
    });
    dLog('axesP', axesP, axesP.mapBy('_internalModel.__data'));
    return axesP;
  })

});

