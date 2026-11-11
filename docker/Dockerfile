FROM eclipse-temurin:8-jdk AS jdk8
FROM eclipse-temurin:11-jdk AS jdk11
FROM eclipse-temurin:21-jdk AS jdk21
FROM eclipse-temurin:25-jdk AS jdk25
FROM eclipse-temurin:26-jdk AS jdk26

FROM node:24-bookworm

RUN apt-get update \
    && apt-get install -y --no-install-recommends git openjdk-17-jdk-headless ca-certificates curl maven cmake build-essential ninja-build pkg-config \
    && rm -rf /var/lib/apt/lists/*

# Gradle finds a toolchain in /usr/lib/jvm by itself, and popular builds ask for 8, 11, 21, 25 and 26 beside 17.
COPY --from=jdk8 /opt/java/openjdk /usr/lib/jvm/temurin-8
COPY --from=jdk11 /opt/java/openjdk /usr/lib/jvm/temurin-11
COPY --from=jdk21 /opt/java/openjdk /usr/lib/jvm/temurin-21
COPY --from=jdk25 /opt/java/openjdk /usr/lib/jvm/temurin-25
COPY --from=jdk26 /opt/java/openjdk /usr/lib/jvm/temurin-26

# A Maven build takes whatever JAVA_HOME says, so the harness tries these in order when a build fails
# on its Java version; Gradle picks its own toolchains from the same directories.
ENV CORPUS_JDKS=17=/usr/lib/jvm/java-17-openjdk-amd64,21=/usr/lib/jvm/temurin-21,11=/usr/lib/jvm/temurin-11,8=/usr/lib/jvm/temurin-8,25=/usr/lib/jvm/temurin-25,26=/usr/lib/jvm/temurin-26

# A project names pnpm or yarn in packageManager; corepack fetches the version it pins.
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable pnpm yarn

ARG DAUKLE_VERSION=0.25.0
ARG DAUKLE_SHA256=819396ce320e08545e1476e0cfdf9a8c876113df8e3fc53ee9476aafd2a84e2e
RUN curl -fsSL -o /usr/local/bin/daukle \
        "https://github.com/daukle/daukle/releases/download/${DAUKLE_VERSION}/daukle-linux-x86_64" \
    && echo "${DAUKLE_SHA256}  /usr/local/bin/daukle" | sha256sum -c - \
    && chmod +x /usr/local/bin/daukle

ARG ANDROID_TOOLS=commandlinetools-linux-11076708_latest.zip
ARG ANDROID_TOOLS_SHA256=2d2d50857e4eb553af5a6dc3ad507a17adf43d115264b1afc116f95c92e5e258
ENV ANDROID_HOME=/opt/android-sdk
RUN apt-get update && apt-get install -y --no-install-recommends unzip && rm -rf /var/lib/apt/lists/*     && curl -fsSL -o /tmp/tools.zip "https://dl.google.com/android/repository/${ANDROID_TOOLS}"     && echo "${ANDROID_TOOLS_SHA256}  /tmp/tools.zip" | sha256sum -c -     && mkdir -p "${ANDROID_HOME}/cmdline-tools"     && unzip -q /tmp/tools.zip -d "${ANDROID_HOME}/cmdline-tools"     && mv "${ANDROID_HOME}/cmdline-tools/cmdline-tools" "${ANDROID_HOME}/cmdline-tools/latest"     && rm /tmp/tools.zip     && yes | JAVA_HOME=/usr/lib/jvm/temurin-21 "${ANDROID_HOME}/cmdline-tools/latest/bin/sdkmanager" --licenses >/dev/null

# Bumped whenever a tool above changes, since a stored reference was built with these tools.
ENV CORPUS_REFERENCE_ENV=1

RUN useradd --create-home corpus && chown -R corpus "${ANDROID_HOME}"     && mkdir /cache && chown corpus /cache
USER corpus
WORKDIR /home/corpus
