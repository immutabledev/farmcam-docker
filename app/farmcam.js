"use strict";

// Read configuration
var fs = require("fs"),
    readline = require('readline'),
    cam = require('node-dahua-api'),
    http = require('http'),
    https = require('https'),
    WebSocket = require('ws'),
    express = require('express'),
    app = express(),
    cors = require('cors'),
    Forecast = require('forecast');

var DEBUG = 0;

var conf = JSON.parse(fs.readFileSync("config.json"));

// Setup URL for camera video stream
var IP = conf.cam_ip;
var PORT = conf.cam_port;
var USER = conf.cam_user;
var PASS = conf.cam_pass;
var URL = 'rtsp://'+USER+':'+PASS+'@'+IP+':'+PORT;

var FINGERPRINT = "";

var STREAM_SECRET = "farmcam",
        STREAM_PORT = 8181,
        WEBSOCKET_PORT = 8182,
	      SOCKETIO_PORT = 8183,
        RECORD_STREAM = false;

var camOptions = {
	host	: IP,
	port 	: PORT, 
	user 	: USER,
	pass 	: PASS,
	log 	: false
};
var CAMSPEED = '4';
var CAMDELAYMS = '200';

console.log('***************************** Farmcam Starting *****************************');
console.log("[Camera] Connecting to: "+URL);
var camera = new cam.dahua(camOptions);
var cameraStatus = {};

camera.on('error', function(error){ console.log("[Camera] Error: ("+error+")"); });
camera.on('ptzStatus', function(status) {
  var str = status.slice(0, -1);
  str = str.toString().replace(/,/g, '", "');
  str = str.replace(/=/g, '": "');
  var jsonStr = '{"' + str + '"}';
  var j = JSON.parse(jsonStr);
  cameraStatus.pan = j['status.Postion[0]'];
  cameraStatus.tilt = j['status.Postion[1]'];
  //console.log("[Camera] Status: "+cameraStatus.pan+","+cameraStatus.tilt); 
});

const key = fs.readFileSync('certs/privkey.pem');
const cert = fs.readFileSync('certs/cert.pem');
const ca = fs.readFileSync('certs/chain.pem');

// SocketIO Server
const httpsIO = require('https').createServer({
        key: key,
        cert: cert,
        ca: ca
    }, app);
const io = require('socket.io').listen(httpsIO);
httpsIO.listen(SOCKETIO_PORT, function() {
  console.log('[SocketIO] Server Running on %s port', SOCKETIO_PORT);
});

// Configure weather
var forecast = new Forecast({
  service: 'forecast.io',
  key: conf.forecastio_key,
  units: 'f', // Only the first letter is parsed 
  cache: true,      // Cache API requests? 
  ttl: {            // How long to cache requests. Uses syntax from moment.js: http://momentjs.com/docs/#/durations/creating/ 
    minutes: 5,
    seconds: 0 
    }
});

var whitelist = ['http://'+conf.domain, 'http://www.'+conf.domain, 'https://'+conf.domain, 'https://www.'+conf.domain];
var corsOptions = {
  origin: function(origin, callback){
    var originIsWhitelisted = whitelist.indexOf(origin) !== -1;
    callback(null, originIsWhitelisted);
  }
};

// Make weather data available via GET
app.get('/forecast', cors(corsOptions), function(req, res) {
	forecast.get([conf.weather_lat,conf.weather_lon], function(err, weather) {
		if(err) return res.send(err);
		res.json(weather);
	});
});

// Websocket Server
const httpsServer = https.createServer({
        key: key,
        cert: cert,
        ca: ca
    }).listen(WEBSOCKET_PORT);

var socketServer = new WebSocket.Server( {server: httpsServer} );
socketServer.connectionCount = 0;
socketServer.on('connection', function(socket, upgradeReq) {
        socketServer.connectionCount++;
        console.log(
                '[WebSocket] New Connection: ',
                (upgradeReq || socket.upgradeReq).socket.remoteAddress,
                (upgradeReq || socket.upgradeReq).headers['user-agent'],
                '('+socketServer.connectionCount+' total)'
        );
        socket.on('close', function(code, message){
                socketServer.connectionCount--;
                console.log(
                        '[WebSocket] Closed Connection ('+socketServer.connectionCount+' total)'
                );
        });
	socket.on('error', (err) => console.log('[WebSocket] Socket Error:', err));
});
socketServer.broadcast = function(data) {
        socketServer.clients.forEach(function each(client) {
                if (client.readyState === WebSocket.OPEN) {
                        client.send(data);
                }
        });
};
socketServer.on('error', (err) => console.log('[WebSocket] Error:', err));

// HTTP Server to accept incomming MPEG-TS Stream from ffmpeg
var streamServer = http.createServer( function(request, response) {
        var params = request.url.substr(1).split('/');

        if (params[0] !== STREAM_SECRET) {
                console.log(
                        '[Stream] Failed Connection: '+ request.socket.remoteAddress + ':' +
                        request.socket.remotePort + ' - wrong secret.'
                );
                response.end();
        }

        response.connection.setTimeout(0);
        console.log(
                '[Stream] New Connection: ' +
                request.socket.remoteAddress + ':' +
                request.socket.remotePort
        );
        request.on('data', function(data){
                socketServer.broadcast(data);
                if (request.socket.recording) {
                        request.socket.recording.write(data);
                }
        });
        request.on('end',function(){
                console.log('close');
                if (request.socket.recording) {
                        request.socket.recording.close();
                }
        });

        // Record the stream to a local file?
        if (RECORD_STREAM) {
                var path = 'recordings/' + Date.now() + '.ts';
                request.socket.recording = fs.createWriteStream(path);
        }
}).listen(STREAM_PORT);

var moveLeftTimer, moveRightTimer, moveUpTimer, moveDownTimer, zoomInTimer, zoomOutTimer = null;

io.on('connection', function(socket){
  var socketId = socket.id;
  var clientIp = socket.request.connection.remoteAddress;
  var q = socket.handshake.query.name;

  console.log('[SocketIO] New Connection: '+clientIp+':'+socketId+' ['+q+']');
  if (!q || q.match(/^[a-z0-9]+$/i) === null) {
     socket.disconnect(true);
  }

  if (conf.lock_controls == "true") {
    socket.disconnect(true);
  }

  var fingerprints = fs.readFileSync('fingerprints.txt', 'utf8').split('\n');
  fingerprints.forEach(function (fingerprint, index) {
    if (q == fingerprint) {
      socket.disconnect(true);
      console.log("[SocketIO] Disconnected banned fingerprint ["+fingerprint+"]");
    }
  }); 

  socket.on('moveLeft', function() {
    if (DEBUG) console.log('Move left.');
    moveCam('Left');
    moveLeftTimer = setTimeout(() => moveCamStop('Left'), 10000);
  });
  socket.on('moveLeftStop', function() {
    if (DEBUG) console.log('Move left stop.');
    moveCamStop('Left');
    if (moveLeftTimer != null) {
      clearTimeout(moveLeftTimer);
      moveLeftTimer = null;
    }
  });
  socket.on('moveRight', function() {
    if (DEBUG) console.log('Move right.');
    moveCam('Right');
  });
  socket.on('moveRightStop', function() {
    if (DEBUG) console.log('Move right stop.');
    moveCamStop('Right');
  });
  socket.on('moveUp', function() {
    if (DEBUG) console.log('Move up.');
    moveCam('Up');
  });
  socket.on('moveUpStop', function() {
    if (DEBUG) console.log('Move up stop.');
    moveCamStop('Up');
  });
  socket.on('moveDown', function() {
    if (DEBUG) console.log('Move down.');
    moveCam('Down');
  });
  socket.on('moveDownStop', function() {
    if (DEBUG) console.log('Move down stop.');
    moveCamStop('Down');
  });
  socket.on('zoomIn', function() {
    if (DEBUG) console.log('Zoom in.');
    zoomIn();
  });
  socket.on('zoomInStop', function() {
    if (DEBUG) console.log('Zoom in stop.');
    zoomInStop();
  });
  socket.on('zoomOut', function() {
    if (DEBUG) console.log('Zoom out.');
    zoomOut();
  });
  socket.on('zoomOutStop', function() {
    if (DEBUG) console.log('Zoom out stop.');
    zoomOutStop();
  });
  socket.on('gotoPreset', function(preset) {
    if (DEBUG) console.log('Goto Preset: '+preset);
    gotoPreset(preset);
  });
  socket.on('getPTZ', function(callback) {
    if (DEBUG) console.log('Get PTZ.');
    callback(cameraStatus.pan);
  });
  socket.on('getConnections', function(callback) {
    if (DEBUG) console.log('Get connections.');
    callback(socketServer.connectionCount);
  });
  socket.on('fingerprint', function(f) {
    console.log('FINGERPRINT: ['+f+'}');
    FINGERPRINT = f;
  });
});

function moveCam(dir) {
	camera.ptzMove(dir, "start", CAMSPEED);
}

function moveCamStop(dir) {
	camera.ptzMove(dir, "stop", CAMSPEED);
}

function zoomIn() {
	camera.ptzZoom(1.0);
}
 
function zoomInStop() {
  camera.ptzZoomStop(1.0);
}

function zoomOut() {
	camera.ptzZoom(-1.0);
}

function zoomOutStop() {
  camera.ptzZoomStop(-1.0);
}

function gotoPreset(preset) {
	camera.ptzPreset(preset);
}

function getStatus() {
	camera.ptzStatus();
}

setInterval(function() { 
	getStatus();
}, 1000);
