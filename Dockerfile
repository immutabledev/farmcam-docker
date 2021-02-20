FROM keymetrics/pm2:latest-alpine

# Bundle APP files
COPY farmcam.js .
COPY package.json .
COPY ecosystem.config.js .
COPY ffmpeg-runner.sh .

# Install app dependencies
ENV NPM_CONFIG_LOGLEVEL warn
RUN npm install --production

# Show current folder structure in logs
RUN ls -al -R

CMD [ "pm2-runtime", "start", "ecosystem.config.js" ]