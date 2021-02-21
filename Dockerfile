FROM keymetrics/pm2:14-buster

# Bundle APP files
COPY farmcam.js .
COPY package.json .
COPY ecosystem.config.js .
COPY ffmpeg-runner.sh .
COPY local_modules local_modules/

# Install app dependencies
ENV NPM_CONFIG_LOGLEVEL warn
RUN npm install --production

CMD [ "pm2-runtime", "start", "ecosystem.config.js" ]