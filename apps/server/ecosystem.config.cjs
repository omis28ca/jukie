module.exports = {
  apps: [
    {
      name: "jukie-server",
      script: "src/index.js",
      cwd: __dirname,
      interpreter: "node",
      env: {
        NODE_ENV: "production"
      },
      autorestart: true,
      restart_delay: 2000,
      max_restarts: 10
    }
  ]
};
