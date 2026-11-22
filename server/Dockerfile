FROM node:24-alpine AS builder

WORKDIR /app

COPY package*.json ./

RUN npm ci --legacy-peer-deps

COPY . .

RUN npm run build

FROM golang:1.23-alpine AS scanner-builder

ARG REALITLSCANNER_REPO=https://github.com/XTLS/RealiTLScanner.git
# Pin to an immutable commit for reproducible builds (main as of 2026-03-25).
ARG REALITLSCANNER_REF=4dbba8cb1d7c6be86b260dd45db7fd2a84d3293b
ARG TARGETOS=linux
ARG TARGETARCH=amd64

WORKDIR /src

RUN apk add --no-cache git
RUN git init . \
    && git remote add origin ${REALITLSCANNER_REPO} \
    && git fetch --depth 1 origin ${REALITLSCANNER_REF} \
    && git checkout --detach FETCH_HEAD
RUN CGO_ENABLED=0 GOOS=${TARGETOS} GOARCH=${TARGETARCH} go build -trimpath -ldflags="-s -w" -o /out/RealiTLScanner-linux-64 .

FROM golang:1.24-alpine AS xray-builder

ARG XRAY_REPO=https://github.com/XTLS/Xray-core.git
# Pin to an immutable release tag supporting XHTTP (stream-one/XMUX), REALITY, Vision, and TLS.
ARG XRAY_REF=v25.3.6
ARG TARGETOS=linux
ARG TARGETARCH=amd64

WORKDIR /xray-src

RUN apk add --no-cache git
RUN git clone --depth 1 --branch ${XRAY_REF} ${XRAY_REPO} . \
    && CGO_ENABLED=0 GOOS=${TARGETOS} GOARCH=${TARGETARCH} go build -o /out/xray -trimpath -ldflags "-s -w -buildid=" ./main

FROM node:24-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --only=production --legacy-peer-deps

# Runtime tools required for checker/scanner integration scripts.
RUN apk add --no-cache \
    bash \
    curl \
    python3 \
    grep \
    gawk \
    coreutils \
    procps \
    postgresql-client \
    ca-certificates

COPY --from=builder /app/dist ./dist
COPY --from=scanner-builder /out/RealiTLScanner-linux-64 /usr/local/bin/RealiTLScanner-linux-64
COPY --from=xray-builder /out/xray /usr/local/bin/xray
RUN chmod +x /usr/local/bin/RealiTLScanner-linux-64 /usr/local/bin/xray

ENV NODE_ENV=production
ENV PORT=3100
ENV XRAY_BIN=/usr/local/bin/xray

EXPOSE 3100

CMD ["node", "dist/src/main"]
