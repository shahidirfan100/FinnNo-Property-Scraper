# The whole run goes through one real Chrome window: headless browsers and plain
# HTTP clients are blocked, and only a visible browser clears the challenge.
# This image ships Google Chrome, and its entrypoint wraps the start command in
# xvfb so headless: false works without a display.
FROM apify/actor-node-playwright-chrome:22-1.65.0-slim

COPY --chown=myuser:myuser package*.json ./

RUN npm --quiet set progress=false \
	&& npm install --omit=dev \
	&& node -e "import('patchright').then(() => console.log('patchright OK'))" \
	&& rm -rf ~/.npm

COPY --chown=myuser:myuser . ./

ENV APIFY_LOG_LEVEL=INFO

CMD npm start --silent
