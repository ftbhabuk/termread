image := "termread"

# Compile the ./termread binary for the current host OS via Docker
build:
    #!/usr/bin/env sh
    case "$(uname -s)-$(uname -m)" in
        Darwin-arm64)  target="bun-darwin-arm64" ;;
        Darwin-x86_64) target="bun-darwin-x64"   ;;
        Linux-aarch64) target="bun-linux-arm64"  ;;
        *)             target="bun-linux-x64"    ;;
    esac
    docker build --target binary --output type=local,dest=. --build-arg "BUN_TARGET=${target}" .

# Build the Docker image for local use
image:
    docker build -t {{image}} .

# Run a URL in the interactive pager (requires a built image)
run url:
    docker run --rm -it {{image}} {{url}}

# Run a URL and print plain text (pipe-friendly)
raw url:
    docker run --rm {{image}} {{url}} --raw
