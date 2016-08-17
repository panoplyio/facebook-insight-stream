var assert = require( "assert" );
var request = require( "request" );
var Promise = require( "bluebird" );
var FacebookInsightStream = require( "./index" );

var BASEURL = "https://graph.facebook.com/v2.5";
var METRICS = require( "./metric-list" );

var req_get = request.get;

describe( "error", function () {
    var result = {};
    var source = {
        apps: [ "myApp" ],
    }
    var _err = { message: "test error" };
    var response = { "myApp": { error: _err, name: "myApp" } }
   
    before( initialize( result, response, source ) )
    after( reset )

    it( "sould emit error", function () {
        assert.equal( result.error.message, "test error" )
    })
})

describe( "retry", function () {
    var result = {};
    var source = {
        apps: [ 'myApp' ],
    }
    var _err = { message: 'retryError' };
    var response = { "myApp": { error: _err, name: "myApp", data: dataGenerator( 1, null ) } }

    before( initialize( result, response, source ) )
    after( reset )

    it( 'retry after specified error', function () {
        var dataSize = Object.keys( result.data[ 0 ] ).length;
        // the data size should be as the size of metrics + 3 columns ( date, name, id )
        assert.equal( dataSize, METRICS.length + 3 );
        assert.equal( result.data.length, 1 )
    })
})

describe( "progress", function () {
    var result = {};
    var source = { 
        apps: [ "myApp" ],
    };
    var response = { "myApp": { data: dataGenerator( 1, null ), name: "myApp" } }

    before( initialize( result, response, source ) )
    after( reset )

    it( "should emit progress", function () {
        assert.equal( result.progress.total, 1 );
        assert.equal( result.progress.loaded, 1 );
        assert.equal( result.progress.message, "{{remaining}} apps remaining" )

    })
})

describe( "empty metric", function () {
    var result = {};
    var source = {
        apps: [ "myApp" ],
    }

    var response = { "myApp": { data: dataGenerator( 1, "api_calls" ), name: "myApp" } }

    before( initialize( result, response, source ) )
    after( reset )

    it( "should read all the metrics except api_calls", function () {
        var row = result.data[ 0 ];

        assert.equal( row[ "api_call" ], undefined );
        assert.equal( Object.keys( row ).length, 51 );
    })

})

describe( "appName and appId", function () {
    var result = {};
    var source = {
        apps: [ "someId" ],
    }

    var response = { "someId": { data: dataGenerator( 1, null ), name: "myApp" } }

    before( initialize( result, response, source ) )
    after( reset )

    it( "sould add appName and appId to each row", function () {
        var row = result.data[ 0 ];

        assert.equal( row[ "appName" ], "myApp" );
        assert.equal( row[ "appId" ], "someId" );
    })
})

describe( "collect", function () {
    var result = {};
    var source = {
        apps: [ "myApp1", "myApp2" ],
    }

    var response = { 
        "myApp1": { data: dataGenerator( 100, null ), name: "myApp1" },
        "myApp2": { data: dataGenerator( 100, null ), name: "myApp2" }
    }

    before( initialize( result, response, source ) )
    after( reset )

    it( "should read 200 rows for two apps", function() {
        assert.equal( result.data.length, 200 );
        assert.equal( result.data[ 0 ].appName, "myApp2" );
        assert.equal( result.data[ 100 ].appName, "myApp1" );
    })
})


function initialize( result, response, source ) {

    result.batchCount = 0;

    return function ( done ) {  

        request.get = function ( url, callback ) { 
            var metric;
            url = url.split( BASEURL )[ 1 ];
            var params = url.split( "?" )[ 0 ].split( "/" );
            var app = params[ 1 ];
            var metric = params[ 3 ];
            var appData = response[ app ].data;
            var appName = response[ app ].name;
            var appError = response[ app ].error;
            var res;

            //we are in the get apps request
            if ( app == "me" ) {
                res = { data: response[ app ] }
            }
            // if there is no metric, we are in the first request so returning the name
            else if ( ! metric ) {
                res = { name: appName };
            } else if ( appError ) {
                res = { error: appError };
                response[ app ].error = null; 
            } else {
                res = { data: appData[ metric ] }
            }

            res = JSON.stringify( res )

            callback( null, { 1: res } ) 
        }  

        var options = {
            pastdays: "30",
            node: "app",
            period: "daily",
            metrics: METRICS,
            itemList: source.apps
        }

        FacebookInsightStream.prototype.handleError = function ( error, retry ) {
            if ( error.message === 'retryError' ) {
                return retry()
            } else {
                this.emit( 'error', error );
            }
        }

        var testStream = new FacebookInsightStream( options )
        .on( "data", function ( chunk ) {
            result.data || ( result.data = [] );
            result.data = result.data.concat( chunk )
        })
        .on( "error", function ( error ) {
            result.error || ( result.error = error );
            done();
            done = function () {};
        })
        .on( "progress", function ( progress ) {
            result.progress = progress;
        })
        .on( "end", function () { done() } )

        result.stream = testStream;
    }
}

function reset () {
    request.get = req_get;
}

// generate data for all the metrics, unless recieved metricname to keep empty
function dataGenerator ( size, emptyMetric, name ) {
    var data = {};
    METRICS.forEach( function ( metric ) {
        var values = [];

        for ( var i = 1; i <= size; i++ ) {
            values.push( {
                //nuiqe date for each row
                end_time: "some_date-" + i ,
                value: i,
            })
        }

        data[ metric ] = []

        if ( metric != emptyMetric ) {
            data[ metric ].push( {
                name: metric,
                values: values,
            })
        }
    })
    // also saving the app name
    data.name = name;
    return data
} 

