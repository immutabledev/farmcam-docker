#!/bin/sh

/usr/bin/ffmpeg -i "rtsp://${CAM_CONTROL_USER}:${CAM_CONTROL_PASS}@${CAM_IP}:${CAM_PORT}/cam/realmonitor?channel=1&subtype=0" -rtsp_transport tcp -err_detect ignore_err -f mpegts -framerate 25 -codec:v mpeg1video -bf 0 -b:v 256k -muxdelay 0.001 http://127.0.0.1:8181/farmcam > /dev/null 2>&1