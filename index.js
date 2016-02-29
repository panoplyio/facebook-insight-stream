// doc: this module is a facebook-insights read stream built over node readable stream
// it provide stream api to read insights data from facebook accounts,
// currently supporting only pages-insight and app-insights.

module.exports = FacebookInsightStream;

var util = require( "util" );
var sugar = require( "sugar" );
var stream = require( "stream" );
var extend = require( "extend" );
var request = require( "request" );
var Promise = require( "bluebird" );

request = Promise.promisifyAll( request )

var BASEURL = "https://graph.facebook.com/v2.5";

//edge url for each node type
var EDGEMAP = {
    page: "insights",
    app: "app_insights",
}

util.inherits( FacebookInsightStream, stream.Readable )
function FacebookInsightStream( options ) {

    stream.Readable.call( this, { objectMode: true } );

    options.edge = EDGEMAP[ options.node ];
    this.options = options;

}

// _read will be called once for each collected item
FacebookInsightStream.prototype._read = function ( ) {

    if ( ! this.items ) {
        return this._init( this._read.bind( this ) )
    }

    if ( ! this.items.length ) {
        return this.push( null )
    }
    var metrics = this.options.metrics.clone();
    var item = this.items.shift();
    var events = this.events.clone();

    this._collect( metrics, item, {}, events )
        .then( this.push.bind( this ) )
}

FacebookInsightStream.prototype._init = function ( callback ) {
    var options = this.options; 

    // building url pattern for all the request
    var until = Date.now();
    var since = new Date();
    since = since.setDate( since.getDate() - options.pastdays )

    // fb ask for timestamp in seconds
    until = Math.round( until / 1000 );
    since = Math.round( since / 1000 );

    var path = [ 
        BASEURL,
        "{id}",
        options.edge,
        "{metric}",
    ].join( "/" )

    var query = [
        "access_token=" + options.token,
        "period=" + options.period,
        "since=" + since,
        "until=" + until,
    ].join( "&" );

    var hasEvents = options.events && options.events.length;
    var breakdowns = options.breakdowns;

    if ( hasEvents ) {
        query += "&event_name={ev}"
    }

    if ( options.aggregate ) {
        query += "&aggregateBy={agg}";
    }

    if ( breakdowns && breakdowns.length ) {
        for ( var i = 0; i < breakdowns.length; i += 1 ) {
            query += "&breakdowns[{index}]={breakdown}".assign( {
                index: i,
                breakdown: breakdowns[ i ]
            });
        }
    }

    // this url is urlPattern shared by all the requests
    // each request using thie pattern should replace the 
    // {id} and {metric} place holders with real values  
    this.url = [ path, query ].join( "?" )

    // options.itemlist can be either array of items or
    // promise that resolved with array of items 
    Promise.resolve( options.itemList )
        .bind( this )
        .map( this._initItem, { concurrency: 3 } )
        .then( function ( items ) {
            this.items = items;
            this.events = options.events || [];

            this.total = items.length;
            this.loaded = 0;
            callback();
        })
        .catch( this.emit.bind( this, "error" ) )
}

FacebookInsightStream.prototype._initItem = function ( item ) {
    var options = this.options;
    var model = {
        base: BASEURL,
        id: item,
        token: options.token
    };

    var url = strReplace( "{base}/{id}?access_token={token}", model )
    
    var title = "FACEBOOK " + options.node.toUpperCase();
    console.log( new Date().toISOString(), title, url )
    
    return request.getAsync( url )
        .get( 1 )
        .then( JSON.parse )
        .then( errorHandler )
        .then( function ( data ) {
            return {
                id: item,
                name: data.name
            }
        })
}

// _collect will be called once for each metric, the insight api request
// single api call for each metric, wich result in a list of values ( value per day)
// so in attempt to create one table with all the metrics,
// we are buffering each result in a key value map, with key for 
// each day in the collected time range, and appending each value
// of the current metric to the appropriate key in the buffer.
// finally we generating single row for each day.

FacebookInsightStream.prototype._collect = function ( metrics, item, buffer, events ) {
    var options = this.options;
    var hasEvents = events && events.length;

    // done with the current item
    if ( ! metrics.length && ! hasEvents ) {
        var data = Object.keys( buffer ).map( function ( key ) {
            var row = buffer[ key ];

            // if the key is constructed with numerous attributes,
            // take the datetime information
            row.date = key.split( "__" )[ 0 ];
            row[ options.node + "Id" ] = item.id;
            row[ options.node + "Name" ] = item.name;
            return row;
        })

        this.emit( "progress", {
            total: this.total,
            loaded: ++this.loaded,
            message: "{{remaining}} " + options.node + "s remaining" 
        })
        return data;
    }

    // for the audience API, we just use one metric ['app_event']
    // with a few events
    var _metric = metrics.shift() || options.metrics[ 0 ];
    var model = { id: item.id, metric: _metric }

    var _ev;
    var _agg;
    if ( hasEvents ) {
        // extend the query model with event name
        // and aggregation type
        _ev = events.shift();
        _agg = aggregationType( _ev );

        extend( model, { ev: _ev, agg: _agg } );
    }

    var url = strReplace( this.url, model );
    var title = "FACEBOOK " + options.node.toUpperCase();

    console.log( new Date().toISOString(), title, url );

    return request.getAsync( url )
        .get( 1 )
        .then( JSON.parse )
        .then( errorHandler )
        .get( "data" )
        .bind( this )
        .then( function ( data ) {
            // in case that there is no data for a given metric
            // we will skip to the next metric
            if ( ! data.length ) {
                var error = new Error( "No data found for the metric " + _metric );
                error.skip = true;
                throw error;
            }
            // in app insight the returned data is list of values
            // in page insight its object that include the list of values
            return data[ 0 ].values || data
        })
        .each( function ( val ) {
            var key = val.end_time || val.time;
            // when using breakdowns we get numerous results for
            // the same date therefore we need to identify unique 
            // keys for the buffer by the date and different breakdowns
            // we're using the '__' to later seperate the date
            Object.keys( val.breakdowns || {} ).forEach( function ( b ){
                key += "__{breakdown}".assign( {
                    breakdown: val.breakdowns[ b ]
                });
            });

            buffer[ key ] || ( buffer[ key ] = {} )

            // either a metric or an event
            var column = _ev ? _ev : _metric;
            buffer[ key ][ column ] = val.value;

            // set breakdowns data if given
            var breakdowns = options.breakdowns;
            if ( !breakdowns || !val.breakdowns ) {
                return;
            }

            for ( var i = 0; i < breakdowns.length; i += 1 ) {
                // options breakdown
                var b = breakdowns[ i ];

                if ( val.breakdowns[ b ] ) {
                    buffer[ key ][ b ] = val.breakdowns[ b ];
                }
            }
        })
        .then( function () {
            return this._collect( metrics, item, buffer, events );
        })
        .catch( function ( error ) {
            if ( error.skip ) {
                return this._collect( metrics, item, buffer )
            } else {
                this.emit( "error", error )
            }
        })
}

function errorHandler ( body )  {
    if ( body.error ) {
        throw new Error( body.error.message )
    } else {
        return body
    }
}

function strReplace ( string, model ) {
    Object.keys( model ).each( function ( name ) {
        string = string.replace( "{" + name + "}", model[ name ] );
    })

    return string;
}

function aggregationType ( ev ) {
    var events = [ "fb_ad_network_imp", "fb_ad_network_click" ];

    var shouldUseCount = ev && events.indexOf( ev ) > -1;
    if ( shouldUseCount ) {
        return "COUNT"
    }

    return "SUM";
}
