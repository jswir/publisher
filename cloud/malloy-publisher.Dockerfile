# Stage 1: Build base malloy-publisher image
FROM oven/bun:1.2 as base-publisher

RUN apt-get update && apt-get install -y bash libc6 wget apt-transport-https gnupg git

# Add Eclipse Temurin repository and install JDK 21
RUN wget -O - https://packages.adoptium.net/artifactory/api/gpg/key/public | gpg --dearmor | tee /usr/share/keyrings/adoptium.gpg > /dev/null
RUN echo "deb [signed-by=/usr/share/keyrings/adoptium.gpg] https://packages.adoptium.net/artifactory/deb $(awk -F= '/^VERSION_CODENAME=/{print$2}' /etc/os-release) main" | tee /etc/apt/sources.list.d/adoptium.list
RUN apt-get update && apt-get install -y temurin-21-jdk

ENV JAVA_HOME=/usr/lib/jvm/temurin-21-jdk
ENV PATH=$JAVA_HOME/bin:$PATH
ENV GOOGLE_APPLICATION_CREDENTIALS="/app/gcp-credentials/key.json"
RUN mkdir -p /app/gcp-credentials
RUN mkdir -p /app/server_root

# Clone and build Publisher - fix for directory conflict
WORKDIR /tmp
RUN git clone https://github.com/malloydata/publisher.git publisher
WORKDIR /tmp/publisher
RUN git submodule init && git submodule update
RUN bun install
RUN bun run build

# Copy built files to final location
WORKDIR /app
RUN cp -r /tmp/publisher/* .

# Stage 2: Add malloy-samples (following official malloy-samples.docker pattern)
FROM base-publisher as final

# Remove the default publisher.config.json that was created in the base image
RUN rm -f /app/server_root/publisher.config.json

# Copy malloy-samples to server_root
RUN cp -r packages/server/malloy-samples /app/server_root/malloy-samples

# This is a hack to copy the publisher.config.json file in the server_root directory
# that will serve the malloy-samples directory
RUN cp packages/server/publisher.config.json /app/server_root/

# Set environment variables
ENV SERVER_ROOT=/app/server_root
ENV PUBLISHER_HOST=0.0.0.0
ENV MCP_HOST=0.0.0.0
ENV MCP_PORT=4040
ENV NODE_ENV=production

# Expose ports
EXPOSE 4000 4040

# The command remains the same as in the base image
CMD bun run packages/server/dist/server.js 