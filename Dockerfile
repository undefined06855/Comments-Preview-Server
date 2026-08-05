FROM oven/bun:1.3.14

WORKDIR /app
COPY . .

RUN bun install

EXPOSE ${PORT}

CMD [ "bun", "main" ]
