FROM nginx:stable

ARG CERTBOT_EMAIL=info@domain.com

ARG DOMAIN_LIST

RUN  apt-get update \
      && apt-get install -y cron certbot python-certbot-nginx bash wget ffmpeg \
      && certbot certonly --standalone --agree-tos -m "${CERTBOT_EMAIL}" -n -d ${DOMAIN_LIST} \
      && rm -rf /var/lib/apt/lists/* \
      && echo "@monthly certbot renew --nginx >> /var/log/cron.log 2>&1" >/etc/cron.d/certbot-renew

# Install pm2
RUN npm install pm2 -g

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