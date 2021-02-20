module.exports = {
    apps : [{
      name: "farmcam",
      script: "./farmcam.js",
      env: {
        NODE_ENV: "development",
      },
      env_production: {
        NODE_ENV: "production",
      }
    },{
        name       : "ffmpeg-runner",
        script     : "./ffmpeg-runner.sh",
    }]
  }