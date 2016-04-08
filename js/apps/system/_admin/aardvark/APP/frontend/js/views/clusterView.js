/*jshint browser: true */
/*jshint unused: false */
/*global arangoHelper, Backbone, templateEngine, $, window, _, nv, d3 */
(function () {
  "use strict";

  window.ClusterView = Backbone.View.extend({

    el: '#content',
    template: templateEngine.createTemplate("clusterView.ejs"),

    events: {
    },

    historyInit: false,
    interval: 3000,
    maxValues: 100,
    knownServers: [],
    chartData: {},
    charts: {},
    nvcharts: [],
    startHistory: {},
    startHistoryAccumulated: {},

    initialize: function () {
      var self = this;

      if (window.App.isCluster) {
        this.dbServers = this.options.dbServers;
        this.coordinators = this.options.coordinators;
        this.updateServerTime();

        //start polling with interval
        window.setInterval(function() {
          var callback = function(data) {
            self.rerenderValues(data);
            self.rerenderGraphs(data);
          };

          // now fetch the statistics history
          self.getCoordStatHistory(callback);
        }, this.interval);
      }
    },

    render: function () {
      this.$el.html(this.template.render({}));
      this.initValues();
      this.getServerStatistics();

      this.initGraphs();
    },

    updateServerTime: function() {
      this.serverTime = new Date().getTime();
    },

    getServerStatistics: function() {
      var self = this;

      this.data = undefined;

      var coord = this.coordinators.first();

      this.statCollectCoord = new window.ClusterStatisticsCollection([],
        {host: coord.get('address')}
      );
      this.statCollectDBS = new window.ClusterStatisticsCollection([],
        {host: coord.get('address')}
      );

      // create statistics collector for DB servers
      var dbsmodels = [];
      _.each(this.dbServers, function(dbs) {
        dbs.each(function(model) {
          dbsmodels.push(model);
        });
      });

      _.each(dbsmodels, function (dbserver) {
        if (dbserver.get("status") !== "ok") {
          return;
        }

        if (self.knownServers.indexOf(dbserver.id) === -1) {
          self.knownServers.push(dbserver.id);
        }

        var stat = new window.Statistics({name: dbserver.id});
        stat.url = coord.get("protocol") + "://"
        + coord.get("address")
        + "/_admin/clusterStatistics?DBserver="
        + dbserver.get("name");

        self.statCollectDBS.add(stat);
      });

      // create statistics collector for coordinator
      this.coordinators.forEach(function (coordinator) {
        if (coordinator.get("status") !== "ok") {return;}

        if (self.knownServers.indexOf(coordinator.id) === -1) {
          self.knownServers.push(coordinator.id);
        }

        var stat = new window.Statistics({name: coordinator.id});

        stat.url = coordinator.get("protocol") + "://"
        + coordinator.get("address")
        + "/_admin/statistics";

        self.statCollectCoord.add(stat);
      });

      // first load history callback
      var callback = function(data) {
        self.rerenderValues(data);
        self.rerenderGraphs(data);
      };

      // now fetch the statistics history
      self.getCoordStatHistory(callback);
      
      this.updateValues();
    },
    
    rerenderValues: function(data) {
      //Connections
      this.renderValue('#clusterConnections', Math.round(data.clientConnectionsCurrent));
      this.renderValue('#clusterConnectionsAvg', Math.round(data.clientConnections15M));

      //RAM
      var totalMem = data.physicalMemory;
      var usedMem = data.residentSizeCurrent;
      this.renderValue('#clusterRam', [usedMem, totalMem]);
    },

    renderValue: function(id, value) {
      if (typeof value === 'number') {
        $(id).html(value);
      }
      else if ($.isArray(value)) {
        var a = value[0], b = value[1];

        var percent = 1 / (b/a) * 100;
        $(id).html(percent.toFixed(1) + ' %');
      }
    },

    updateValues: function() {
      this.renderValue('#clusterNodes', this.statCollectCoord.size());
      this.renderValue('#clusterRam', [1024, 4096]);
    },

    initValues: function() {

      var values = [
        "#clusterNodes",
        "#clusterRam",
        "#clusterConnections",
        "#clusterConnectionsAvg",
      ];

      _.each(values, function(id) {
        $(id).html('<i class="fa fa-spin fa-circle-o-notch" style="color: rgba(0, 0, 0, 0.64);"></i>'); 
      });
    },

    graphData: {
      data: {
        sent: [],
        received: []
      },
      http: [],
      average: []
    },

    checkArraySizes: function() {
      var self = this;

      _.each(self.chartsOptions, function(val1, key1) {
        _.each(val1.options, function(val2, key2) {
            console.log(self.chartsOptions[key1].options[key2].values.length);
          if (val2.values.length === self.maxValues) {
            self.chartsOptions[key1].options[key2].values.shift();
          }
        });
      });
    },

    formatDataForGraph: function(data) {
      var self = this;

      if (!self.historyInit) {
        _.each(data.times, function(time, key) {

          //DATA
          self.chartsOptions[0].options[0].values.push({x:time, y: data.bytesSentPerSecond[key]});
          self.chartsOptions[0].options[1].values.push({x:time, y: data.bytesReceivedPerSecond[key]});

          //HTTP
          self.chartsOptions[1].options[0].values.push({x:time, y: self.calcTotalHttp(data.http, key)});

          //AVERAGE
          self.chartsOptions[2].options[0].values.push({x:time, y: data.avgRequestTime[key]});
        });
        self.historyInit = true;
      }
      else {
        self.checkArraySizes();

        //DATA
        self.chartsOptions[0].options[0].values.push({
          x: data.times[data.times.length - 1],
          y: data.bytesSentPerSecond[data.bytesSentPerSecond.length - 1]
        });
        self.chartsOptions[0].options[1].values.push({
          x: data.times[data.times.length - 1],
          y: data.bytesReceivedPerSecond[data.bytesReceivedPerSecond.length - 1]
        });
        //HTTP
        self.chartsOptions[1].options[0].values.push({
          x: data.times[data.times.length - 1],
          y: self.calcTotalHttp(data.http, data.bytesSentPerSecond.length - 1)
        });
        //AVERAGE
        self.chartsOptions[2].options[0].values.push({
          x: data.times[data.times.length - 1],
          y: data.avgRequestTime[data.bytesSentPerSecond.length - 1]
        });


      }
    },

    chartsOptions: [
      {
        id: "#clusterData",
        count: 2,
        options: [
          {
            area: true,
            values: [],
            key: "Bytes out",
            color: 'rgb(23,190,207)',
            strokeWidth: 2,
            fillOpacity: 0.1
          },
          {
            area: true,
            values: [],
            key: "Bytes in",
            color: "rgb(188, 189, 34)",
            strokeWidth: 2,
            fillOpacity: 0.1
          }
        ]
      },
      {
        id: "#clusterHttp",
        options: [{
          area: true,
          values: [],
          key: "Bytes",
          color: "rgb(0, 166, 90)",
          fillOpacity: 0.1
        }]
      },
      {
        id: "#clusterAverage",
        data: [],
        options: [{
          area: true,
          values: [],
          key: "Bytes",
          color: "rgb(243, 156, 18)",
          fillOpacity: 0.1
        }]
      }
    ],

    initGraphs: function() {
      var self = this;

      _.each(self.chartsOptions, function(c) {
        nv.addGraph(function() {
          self.charts[c.id] = nv.models.stackedAreaChart()
          .options({
            transitionDuration: 300,
            useInteractiveGuideline: true,
            showControls: false,
            noData: 'Fetching data...'
          });

          self.charts[c.id].xAxis
          .axisLabel("")
          .tickFormat(function(d) {
            var x = new Date(d * 1000);
            return (x.getHours() < 10 ? '0' : '') + x.getHours() + ":" +  
              (x.getMinutes() < 10 ? '0' : '') + x.getMinutes() + ":" + 
              (x.getSeconds() < 10 ? '0' : '') + x.getSeconds();
          })
          .staggerLabels(false);

          // TODO UPDATE SINGLE VALUES AFTER UPDATE
          self.charts[c.id].yAxis
          .axisLabel('')
          .tickFormat(function(d) { //TODO 1k bytes sizes
            if (d === null) {
              return 'N/A';
            }
            return d3.format(',.2f')(d);
          });

          var data, lines = self.returnGraphOptions(c.id);
          if (lines.length > 0) {
            _.each(lines, function (val, key) {
              c.options[key].values = val;
            });
          }
          else {
            c.options[0].values = [];
          }
          data = c.options;

          self.chartData[c.id] = d3.select(c.id).append('svg')
          .datum(data)
          .transition().duration(1000)
          .call(self.charts[c.id])
          .each('start', function() {
            window.setTimeout(function() {
              d3.selectAll(c.id + ' *').each(function() {
                if (this.__transition__) {
                  this.__transition__.duration = 1;
                }
              });
            }, 0);
          });

          nv.utils.windowResize(self.charts[c.id].update);
          self.nvcharts.push(self.charts[c.id]);
          
          return self.charts[c.id];
        });
      });
    },

    returnGraphOptions: function(id) {
      var arr = []; 
      if (id === '#clusterData') {
        //arr =  [this.graphData.data.sent, this.graphData.data.received];
        arr = [
          this.chartsOptions[0].options[0].values,
          this.chartsOptions[0].options[1].values
        ];
      }
      else if (id === '#clusterHttp') {
        arr = [this.chartsOptions[1].options[0].values];
      }
      else if (id === '#clusterAverage') {
        arr = [this.chartsOptions[2].options[0].values];
      }
      else {
        arr = [];
      }

      return arr;
    },

    rerenderGraphs: function(input) {
      var self = this, data, lines;
      this.formatDataForGraph(input);

      _.each(self.chartsOptions, function(c) {
        lines = self.returnGraphOptions(c.id);

        if (lines.length > 0) {
          _.each(lines, function (val, key) {
            c.options[key].values = val;
          });
        }
        else {
          c.options[0].values = [];
        }
        data = c.options;

        //update nvd3 chart
        if (data[0].values.length > 0) {
          if (self.historyInit) {
            if (self.charts[c.id]) {
              self.charts[c.id].update();
            }
          }
        }
        
      });
    },

    calcTotalHttp: function(object, pos) {
      var sum = 0;
      _.each(object, function(totalHttp) {
        sum += totalHttp[pos];
      });
      return sum;
    },

    getCoordStatHistory: function(callback) {
      var self = this, promises = [], historyUrl;

      var merged = {
        http: {}
      };

      var getHistory = function(url) {
        return $.get(url, {count: self.statCollectCoord.size()}, null, 'json');
      };

      var mergeHistory = function(data) {


        var onetime = ['times'];
        var values = [
          'physicalMemory',
          'residentSizeCurrent',
          'clientConnections15M',
          'clientConnectionsCurrent'
        ];
        var http = [
          'optionsPerSecond',
          'putsPerSecond',
          'headsPerSecond',
          'postsPerSecond',
          'getsPerSecond',
          'deletesPerSecond',
          'othersPerSecond',
          'patchesPerSecond'
        ];
        var arrays = [
          'bytesSentPerSecond',
          'bytesReceivedPerSecond',
          'avgRequestTime'
        ];

        var counter = 0, counter2;

        _.each(data, function(stat) {
          if (typeof stat === 'object') {
            if (counter === 0) {
              //one time value
              _.each(onetime, function(value) {
                merged[value] = stat[value];
              });

              //values
              _.each(values, function(value) {
                merged[value] = stat[value];
              });

              //http requests arrays
              _.each(http, function(value) {
                merged.http[value] = stat[value];
              });

              //arrays
              _.each(arrays, function(value) {
                merged[value] = stat[value];
              });

            }
            else {
              //values
              _.each(values, function(value) {
                merged[value] = merged[value] + stat[value];
              });
              //http requests arrays
              _.each(http, function(value) {
                  counter2 = 0;
                  _.each(stat[value], function(x) {
                    merged.http[value][counter] = merged.http[value][counter] + x;
                    counter2++;
                  });
              });
              _.each(arrays, function(value) {
                counter2 = 0;
                _.each(stat[value], function(x) {
                  merged[value][counter] = merged[value][counter] + x;
                  counter2++;
                });
              });
            }
          counter++;
          }
        });
      };

      this.statCollectCoord.each(function(coord) {
        historyUrl = coord.url + '/short';
        promises.push(getHistory(historyUrl));
      });

      $.when.apply($, promises).done(function() {
        //wait until all data is here
        var arr = [];
        _.each(promises, function(stat) {
          arr.push(stat.responseJSON);
        });
        mergeHistory(arr);
        callback(merged);
      });
    }

  });
}());