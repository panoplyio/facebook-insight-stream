# facebook-insight-stream
FacebookInsightStream provide stream API, built over node-readable-stream, to read facebook insights
using the facebook Graph API V2.5.
Currently facebook insights api return data per metric, this module joins all the list 
to one list by the insight date.

Currently support the following insights:

* [pages-insights]( https://developers.facebook.com/docs/graph-api/reference/page/insights/ )
* [app-insights](https://developers.facebook.com/docs/graph-api/reference/v2.5/insights/)

### Usage

```javascript
var FacebookInsightStream = require( "facebook-insight-stream" );

var pageStream = new FacebookInsightStream( options )
    //  return list of insights  e.g [ { name: "mypage", views: "10" } ]
    .on( "data", console.log ) 
    // "Aouth error"
    .on( "error", console.log ) 
    // progress status  { total: "2", loaded: "1", message: "{{remaining}} pages remain"  }
    .on( "progress", console.log )
```

