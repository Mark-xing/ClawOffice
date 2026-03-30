module.exports = {
  apps: [
    {
      name: "open-office-gateway",
      cwd: "./apps/gateway",
      script: "npx",
      args: "tsx watch src/index.ts",
      env: {
        NODE_ENV: "development",
        WS_PORT: "9099",
      },
      autorestart: true,
      max_restarts: 10,
      restart_delay: 3000,
      watch: false,  // tsx watch handles file watching itself
    },
    {
      name: "open-office-web",
      cwd: "./apps/web",
      script: "npx",
      args: "next dev --turbopack",
      env: {
        NODE_ENV: "development",
      },
      autorestart: true,
      max_restarts: 10,
      restart_delay: 3000,
      watch: false,
    },
  ],
};
