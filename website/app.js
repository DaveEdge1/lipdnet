// app.js
var express = require('express');
var process = require("process");
process
    .on('unhandledRejection', (reason, p) => {
        console.error(reason, 'Unhandled Rejection at Promise', p);
    })
    .on('uncaughtException', err => {
        console.error(err, 'Uncaught Exception thrown');
        process.exit(1);
    });
var port = process.env.PORT || 3000;
var logger = require("./node_modules_custom/node_log.js");
var rimraf = require("rimraf");
// chdir to the project folder base. Everything we want to do will be in relation to this location
// logger.info("app.js: Changing process dir to project root: /lipd/nodejs/website");
process.chdir(__dirname);
var fs = require("fs");
var path = require("path");
var cookieParser = require('cookie-parser');
var bodyParser = require('body-parser');
// var logger = require('morgan');
var multer = require("multer");
var sys = require('sys');
var favicon = require('serve-favicon');
var app = express();
var routes = require('./routes/index');
var users = require('./routes/users');


// Get a list of all the directories in the Tmp folder.
var getDirectories = function(srcpath) {
  return fs.readdirSync(srcpath)
    .filter(function(file){
      if(fs.lstatSync(path.join(srcpath, file)).isDirectory()){
        return file;
      }
    });
};

// Where built LiPD/NOAA files are staged. Resolved from __dirname rather than
// process.cwd(), because createArchive() in routes/index.js chdir's into a tmp
// dir for the duration of a zip and the sweep must not follow it there.
var TMP_DIR = path.join(__dirname, "tmp");

// How long a staged file stays on disk before the sweep removes it. This has to
// outlast the gap between POST /files (which builds the file) and GET /files/:id
// (which the browser requests moments later) -- plus however long the user spends
// looking at a "file contains errors" dialog first, and any retry. The old value
// was 60 seconds, which could delete a file out from under the download that was
// about to ask for it and answer 500. One hour, overridable for tuning.
var TMP_RETENTION_MS = parseInt(process.env.TMP_RETENTION_MS, 10) || 3600000;
// How often to sweep.
var TMP_SWEEP_INTERVAL_MS = parseInt(process.env.TMP_SWEEP_INTERVAL_MS, 10) || 900000;

// The routes assume tmp/ exists -- they swallow the mkdir error and then fail
// later with a 500 on download -- so make sure it's there before serving.
try {
  fs.mkdirSync(TMP_DIR, { recursive: true });
} catch(err){
  logger.info("app: could not create tmp dir: " + err);
}

// Recursively remove all lipd file data in the tmp folder that is older than
// TMP_RETENTION_MS.
var cleanTmpDir = function(){
  // this code will only run when time has elapsed

  var tmpDir = TMP_DIR;
  logger.info("app: Starting tmp cleaning...");
  try {
    var _dirs = getDirectories(tmpDir);
    // logger.info("Tmp Directories: [" + _dirs + "]");
    if(_dirs){
      _dirs.forEach(function(innerDir, index) {
        // console.log("Is it a directory?: " + _isDirectory);
        // Only run the cleanup for directories. Not files.
          fs.stat(path.join(tmpDir, innerDir), function(err, stat) {
            var endTime, now;
            if (err) {
              return console.error(err);
            }
            now = new Date().getTime();
            // Age off the most recent activity in the dir, not just its creation:
            // ctime alone would start the clock before the zip finished writing.
            var lastTouched = Math.max(
              new Date(stat.ctime).getTime(),
              new Date(stat.mtime).getTime()
            );
            endTime = lastTouched + TMP_RETENTION_MS;
            if (now > endTime) {
              return rimraf(path.join(tmpDir, innerDir), function(err) {
                if (err) {
                  return console.error(err);
                }
                logger.info("app: Removed Dir: " + innerDir);
              });
            }
          });
       });
    }
  } catch(err){
    logger.info(err);
  }

};

// Sweep on the configured interval (default: every 15 minutes).
setInterval(cleanTmpDir, TMP_SWEEP_INTERVAL_MS);

// Multer functions to save uploaded files
var storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, './tmp');
  },
  onFileUploadStart: function (file) {
    console.log("app: " + file.originalname + ' is starting ...');
  },
  onFileUploadComplete: function (file) {
    console.log("app: " + file.fieldname + ' uploaded to  ' + file.path);
  }
});

// Trust NODE_ENV. Default to production so error responses don't leak stack
// traces when the var is unset.
app.set("environment", process.env.NODE_ENV === "development" ? "development" : "production");


// view engine setup
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'jade');
app.use(favicon(__dirname + '/public/favicon.ico'));
app.use(cookieParser());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));
// app.use(express.static(path.join(__dirname, 'bower_components')));
app.use(express.static(path.join(__dirname, 'routes', 'files')));
app.use(multer({ storage: storage, limits:{ fieldSize: 25 * 1024 * 1024 }}).single('file'));

// Give DB access to our routes
// app.use(function(req, res, next){
// 	req.db = db;
// 	next();
// });



// Attach the router to our app.
app.use('/', routes);
app.use('/users', users);


// catch 404 and forward to error handler
app.use(function(req, res, next) {
  res.status(404).render('404');
});

// development error handler
// will print stacktrace
if (app.get("environment") === 'development') {
  app.use(function(err, req, res, next) {
    res.status(err.status || 500);
    logger.info(err.message);
    res.render('error', {
      message: err.message,
      error: err
    });
  });
} else {
  // production error handler
  // no stacktraces leaked to user
  app.use(function(err, req, res, next) {
    res.status(err.status || 500);
    res.render('error', {
      message: err.message,
      error: {}
    });
  });
}

module.exports = app;
