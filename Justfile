image := "termread"

# Build the Docker image for local use
image:
    docker build -t {{image}} .

# Run a URL in the interactive pager (requires a built image)
run url:
    docker run --rm -it {{image}} {{url}}

# Run a URL and print plain text (pipe-friendly)
raw url:
    docker run --rm {{image}} {{url}} --raw
