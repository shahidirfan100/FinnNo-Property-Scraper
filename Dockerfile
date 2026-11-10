# The run goes through one real Chrome window: headless browsers and plain HTTP
# clients are blocked, and only a visible browser clears the DataDome challenge.
# This image ships Google Chrome and xvfb so headful Chrome works without a display.
FROM apify/actor-python-playwright-chrome:3.13-1.62.0

COPY --chown=myuser:myuser requirements.txt ./
RUN echo "Python version:" \
 && python --version \
 && pip install --no-cache-dir -r requirements.txt \
 && scrapling install

COPY --chown=myuser:myuser . ./
RUN python -m compileall -q src/

ENV APIFY_LOG_LEVEL=INFO

CMD ["python", "-m", "src"]
