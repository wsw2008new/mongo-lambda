var ML = require('../../lib');
var Lab = require('lab');
var Code = require('code');
var Async = require('async');
var MongoClient = require('mongodb').MongoClient;


// Declare internals
var internals = {};
// Test shortcuts
var lab = exports.lab = Lab.script();
var before = lab.before;
var beforeEach = lab.beforeEach;
var after = lab.after;
var describe = lab.describe;
var it = lab.it;
var expect = Code.expect;

var testReports = internals.testReports = require('../reports.js');

internals.scrubMaster = function(next) {
    internals.db.collection('master').remove({}, function(err, noDocs) {
        expect(err).to.not.exist();
        next(err);
    })
}

internals.scrubSpeed = function(next) {
    Object.keys(testReports).forEach(function(key) {
      internals.db.collection(testReports[key].name+'_delta').remove({}, function(err, noDocs) {
        expect(err).to.not.exist();
      });
    });

    next();

}

internals.scrubBatches = function(next) {
    Object.keys(testReports).forEach(function(key) {
      internals.db.collection(testReports[key].name+'_batches').remove({}, function(err, noDocs) {
        expect(err).to.not.exist();
      });
    });

    next();

}
internals.startLambda = function(lambda, next) {
  lambda.start(function(){
    next();
  });
};

internals.insertData = function(lambda, next) {
  lambda.insert({ua: "iphone"}, function(err, results) {
    expect(err).to.not.exist();
    next(err);
  });
};

internals.initDB = function (url, next) {

  MongoClient.connect(url, function(err, db) {
    expect(err).to.not.exist();
    internals.db = db;
    next();
  });
};

describe('Mongo Lambda', function () {

    var config = {
        url: 'mongodb://localhost:27017/mongo-lambda-test',
        masterColl: "master"
    };

    beforeEach(function(done) {
      var testsArray = [];
      Object.keys(testReports).forEach(function(key) {
        testsArray.push(testReports[key])
      });
        Async.series({
            initDB: Async.apply(internals.initDB, config.url),
            scrubMaster: internals.scrubMaster,
            scrubSpeed: internals.scrubSpeed,
            scrubBatches: internals.scrubBatches
        }, function(err, results) {
            expect(err).to.not.exist();
            done();
        });
    });

    it('validates good configuration', function (done) {
        var instance = function () {
            var lambda = new ML.Lambda(config);
        };
        expect(instance).to.not.throw();
        done()
    });

    it('invalidates bad configuration', function (done) {
        var badConfig = {};
        var instance = function () {
            var lambda = new ML.Lambda(badConfig);
        };
        expect(instance).to.throw();
        done()
    });


    it('can start', function (done) {
        var start = function () {
            var lambda = new ML.Lambda(config);

            lambda.reports([testReports.startTest]);

            lambda.start(function() {})
        };
        expect(start).to.not.throw();
        done();
    });

    it('inserts data into master collections', function (done) {
        var lambda = new ML.Lambda(config);

        lambda.reports([testReports.insertMasterTest]);

        lambda.start(function() {
            lambda.insert({ua: "specific"}, function(err, results) {
                internals.db.collection('master').find({ua: "specific"}).toArray(function(err, doc) {
                    expect(err).to.not.exist();
                    expect(doc).to.exist();
                    expect(doc.length).to.equal(1);
                    done();
                })
            });
        })
    });

    it('inserts array of data into master collections', function (done) {
        var lambda = new ML.Lambda(config);

        lambda.reports([testReports.insertMasterTest]);

        lambda.start(function() {
            lambda.insert([{ua: "specific2"}, {ua: "specific2"}], function(err, results) {
                internals.db.collection('master').find({ua: "specific2"}).toArray(function(err, doc) {
                    expect(err).to.not.exist();
                    expect(doc).to.exist();
                    expect(doc.length).to.equal(2);
                    done();
                })
            });
        })
    });

    it('inserts data into speed collections', function (done) {
        var lambda = new ML.Lambda(config);

        lambda.reports([testReports.insertSpeedTest]);

        lambda.start(function() {
            lambda.insert({ua: "specific"}, function(err, results) {
                internals.db.collection(testReports.insertSpeedTest.name+'_delta').find({ua: "specific"}).toArray(function(err, doc) {
                    expect(err).to.not.exist();
                    expect(doc).to.exist();
                    expect(doc.length).to.equal(1);
                    done();
                })
            });
        })
    });

    it('inserts array of data into speed collections', function (done) {
        var lambda = new ML.Lambda(config);

        lambda.reports([testReports.insertSpeedTest]);

        lambda.start(function() {
            lambda.insert([{ua: "specific2"}, {ua: "specific2"}], function(err, results) {
                internals.db.collection(testReports.insertSpeedTest.name+'_delta').find({ua: "specific2"}).toArray(function(err, doc) {
                    expect(err).to.not.exist();
                    expect(doc).to.exist();
                    expect(doc.length).to.equal(2);
                    done();
                })
            });
        })
    });

    it('can start without starting cron', function (done) {
        var lambda = new ML.Lambda(config);
        lambda.reports([testReports.startNoCronTest]);

        lambda.start(function() {
            setTimeout(function() {
                lambda.batches(testReports.startNoCronTest.name, function(err, batches) {
                    expect(batches.length).to.equal(0);
                    done();
                });
            }, 1500);
        });
    });

    it('correctly adds ttl index', { timeout: 60*1000 }, function(done) {
      var conf = {
        url: 'mongodb://localhost:27017/mongo-lambda-test',
        masterColl: "masterTTL",
        ttl: 1,
      };

      var lambda = new ML.Lambda(conf);

      lambda.reports([testReports.ttlTest]);

      Async.series([
          Async.apply(internals.startLambda, lambda),
      ],
      function(err, results) {
        expect(err).to.not.exist();
          Async.each(['masterTTL', testReports.ttlTest.name+'_delta'], function(coll, next) {
            internals.db.collection(coll).indexes(function(err, indexes) {
              expect(err).to.not.exist();
              expect(indexes[1]).to.exist();
              expect(indexes[1].name).to.equal('_ts_1');
              expect(indexes[1].expireAfterSeconds).to.equal(conf.ttl);
              next(err);
            });
          }, function(err) {
            done();
          });
      });

    });

    it('can reprocess data', { timeout: 60*1000 }, function(done) {
      var conf = {
        url: 'mongodb://localhost:27017/mongo-lambda-test',
        masterColl: "master"
      };

      var lambda = new ML.Lambda(conf);

      lambda.reports([testReports.reprocessTest]);
      
      var start = new Date();
      var dates = [start];
      for(var i = 1; i < 10; i++) {
        dates.push(new Date(start.getTime() - i * 1000));
      };

      Async.series([
          Async.apply(internals.startLambda, lambda),
          Async.apply(lambda.reprocess, testReports.reprocessTest.name, dates)
      ],
      function(err, results) {
        
            expect(err).to.not.exist();
            var find = {
              from: {$gte: dates[0]},
              to: {$lte: dates[dates.length -1]}
            }
            internals.db.collection(testReports.reprocessTest.name+"_batches").find(find).toArray(function(err, docs) {
              expect(err).to.not.exist();
              expect(docs.length).to.equal(dates.length-1);
              done();
            });
          
      });

    });
    it('keeps correct total', { timeout: 60*1000 +1000}, function (done) {
        var lambda = new ML.Lambda(config);
        lambda.reports([testReports.totalTest]);

        var i = 0;
        var increment = function() {
          Async.series({
            insert: Async.apply(internals.insertData, lambda),
            data: Async.apply(getData, lambda)
          },
          function(err, results) {
            expect(err).to.not.exist();
            i++;
            var tot = calcTotal(results.data);
            // console.log('TOTAL:'+tot);
            expect(tot).to.equal(i);
            if(i < 100) {
              increment();
            } else {
              done();
            }
          });
        }

        var getData = function(lambda, next) {
          setTimeout(function(){
            Async.parallel({
              batches: Async.apply(lambda.batches, testReports.totalTest.name),
              onTheFly: Async.apply(lambda.speedAgg, testReports.totalTest.name)
            },
            function(err, results) {
              expect(err).to.not.exist();
              next(err, results);
            });
          }, 10);
        }

        var calcTotal = function(results) {
          var total = 0;
          results.batches.forEach(function(batch) {
            if (batch.data.length > 0) {
              total = total + batch.data[0].count;
            }
          })
          // console.log('batch layer: '+ total);

          if(results.onTheFly.length > 0) {
            // console.log('speed layer: '+ results.onTheFly[0].count)
            total = total + results.onTheFly[0].count;
          }
          return total;
        }

        Async.series([
          Async.apply(internals.startLambda, lambda)
        ], function(err) {
          expect(err).to.not.exist();
          increment();
        })
    });
});
