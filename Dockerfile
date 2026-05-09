# Builder runs on the native host platform; Bun cross-compiles for the target.
FROM --platform=$BUILDPLATFORM oven/bun:1 AS builder

ARG TARGETARCH
# Explicit override used by `just build` to cross-compile for the host OS.
# When unset, falls back to TARGETARCH for the CI multi-platform Linux build.
ARG BUN_TARGET=""

WORKDIR /app

COPY package.json bun.lock ./
RUN bun install --no-frozen-lockfile

COPY *.ts ./
RUN if [ -n "${BUN_TARGET}" ]; then \
      target="${BUN_TARGET}"; \
    else \
      case "${TARGETARCH}" in \
        arm64) target="bun-linux-arm64" ;; \
        *)     target="bun-linux-x64"   ;; \
      esac; \
    fi \
    && bun build cli.ts --compile --target "${target}" --outfile termread

# Export stage: extract just the binary with --output type=local,dest=.
FROM scratch AS binary
COPY --from=builder /app/termread /termread

FROM oven/bun:1-slim

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/*.ts ./

USER bun
ENTRYPOINT ["bun", "run", "cli.ts"]
