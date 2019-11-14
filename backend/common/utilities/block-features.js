var ObjectID = require('mongodb').ObjectID;

/*----------------------------------------------------------------------------*/

/* global exports */

const trace_block = 1;

/** ObjectId is used in mongo shell; the equivalent defined by the node js client library is ObjectID; */
const ObjectId = ObjectID;

/*----------------------------------------------------------------------------*/


/** Count features of the given blocks.
 *
 * @param blockCollection dataSource collection
 * @param blockIds  ids of data blocks
 *
 * @return cursor	: features
 */
exports.blockFeaturesCount = function(db, blockIds) {
  // initial draft based on blockFeaturesInterval()
  let featureCollection = db.collection("Feature");
  if (trace_block)
    console.log('blockFeaturesCount', blockIds);
  let ObjectId = ObjectID;

  let
    matchBlock =
    [
	    { $match :  { "blockId" : {$in : blockIds.map(function (blockId) { return ObjectId(blockId); }) }}},
      { $group: { _id: '$blockId', featureCount: { $sum: 1 } } }
    ],

    pipeline = matchBlock;

  if (trace_block)
    console.log('blockFeaturesCount', pipeline);
  if (trace_block > 1)
    console.dir(pipeline, { depth: null });

  let result =
    featureCollection.aggregate ( pipeline, {allowDiskUse: true} );

  return result;

};

/*----------------------------------------------------------------------------*/


/** Count features of the given block in bins.
 *
 * @param blockCollection dataSource collection
 * @param blockId  id of data block
 * @param nBins number of bins to group block's features into
 *
 * @return cursor	: binned feature counts
 * { "_id" : { "min" : 4000000, "max" : 160000000 }, "count" : 22 }
 * { "_id" : { "min" : 160000000, "max" : 400000000 }, "count" : 21 }
 */
exports.blockFeaturesCounts = function(db, blockId, nBins = 10) {
  // initial draft based on blockFeaturesCount()
  let featureCollection = db.collection("Feature");
  if (trace_block)
    console.log('blockFeaturesCount', blockId, nBins);
  let ObjectId = ObjectID;

  let
    matchBlock =
    [
      {$match : {blockId :  ObjectId(blockId)}},
      { $bucketAuto: { groupBy: {$arrayElemAt : ['$value', 0]}, buckets: Number(nBins), granularity : 'R5'}  }
    ],

    pipeline = matchBlock;

  if (trace_block)
    console.log('blockFeaturesCount', pipeline);
  if (trace_block > 1)
    console.dir(pipeline, { depth: null });

  let result =
    featureCollection.aggregate ( pipeline, {allowDiskUse: true} );

  return result;

};

