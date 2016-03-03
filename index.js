/**
 *  Site structure
 *
 *  home/
 *      about/
 *         about.en.md
 *         about.se.md
 *      features/
 *      pricing/
 *      faq/
 *      support/
 *      news/
 *      contact/
 *
 *  templates/
 *      main.jade
 *      about.jade
 *      features.jade
 *      faq.jade
 *      support.jade
 *      news.jade
 *      contact.jade
 *
 *  partials/
 *  assets/
 *    css/
 *      about/
 *    img/
 *      pricing/
 */

/*
1) Read the templates.
2) Traverse home to create all the routes into an object.
3) Render every route in the build directory (using the templates, partials, etc.).
*/

var Promise = require('bluebird');
var _ = require('lodash');
var fs = Promise.promisifyAll(require('fs-extra'));
var path = require('path');
var marked = require('marked');
var mime = require('mime');

Promise.config({
  longStackTraces: true
})

var engines = {};

/**
 * Builds a site into a static site structure that can be served
 * by any static web server.
 *
 */
module.exports.build = function build(src, dst) {
  return createRoutes(path.join(src, 'home')).then(function (routes) {
	   return renderRoutes(
      routes,
      path.join(src, 'commons'),
      path.join(src, 'templates'),
      path.join(src, 'partials'),
      dst, {
        defaultLanguage: 'en'
      });
  });
}

module.exports.register = function register( fn, partialsFn, exts, outputExt ) {
  exts = _.isArray( exts ) ? exts : [exts];

  _.each(exts, function(ext){
    var mimeType = mime.lookup('dummy.'+ext);
    engines[mimeType] = {
      render: fn,
      register: partialsFn,
      ext: outputExt
    };
  });
}

function createRoutes(_path) {
  var routes = {};

  return fs.readdirAsync(_path).map(function (filename) {
    var subpath = path.join(_path, filename);
    return fs.statAsync(subpath).then(function (stat) {
      if (stat.isDirectory()) {
        return createRoutes(subpath).then(function (children) {
          routes[filename] = children;
        });
      } else if (stat.isFile()) {
        switch(mime.lookup(subpath)){
          case 'text/x-markdown':
          case 'text/plain':
          case 'application/json':
            routes['__content'] = routes['__content'] ||  [];
            routes['__content'].push(subpath);
            break;
          case 'text/css':
          case 'text/less':
          case 'text/x-scss':
            routes['__css'] = routes['__css'] ||  [];
            routes['__css'].push(subpath);
	          break;
          case 'image/png':
          case 'image/jpeg':
            routes['__img'] = routes['__img'] ||  [];
            routes['__img'].push(subpath);
	          break;
          case 'application/javascript':
            routes['__js'] = routes['__js'] ||  [];
            routes['__js'].push(subpath);
            break;
          default:
            console.log("marlin: warning: Invalid file:", subpath, mime.lookup(subpath));
        }
      }
    });
  }).then(function () {
    return routes;
  });
}

// TODO: remove as global.
var site = {};

function renderRoutes(routes, commonsPath, templatesPath, partialsPath, destPath, opts) {
  // Get languages list
  var languages = ['en', 'se', 'es', 'de']; // TODO: convert into a function

  return Promise
    .join(loadFiles(commonsPath), loadFiles(templatesPath), loadFiles(partialsPath))
    .spread(function (commons, templates, partials){

      registerPartials(partials);

      Promise.each(_.keys(commons), function(name){
        // Hack we just take the first mimetype (we should instead merge all the types)
        var mimeType = _.first(_.keys(commons[name]));
        var data = {
          content: commons[name][mimeType],
          mimeType: mimeType
        }
        return readContentFile( data ).then(function(data){
          site[name] = data;
        });
      }).then(function(){
        console.log("SITE:", site);
      }).then(function(){
        return buildRoute(routes, 'home', destPath, templates, partials, languages[0], opts);
      });
  });
}

/**
 * opts {
 *  defaultLanguage: 'en'
 *
 * }
 * Rendered routes:
 *
 * /home
 *  /en (ommited if default language)
 *    index.html
 *    /about
 *      index.html
 *      /subpage1
 *      /subpage2
 *  /se
 *  /de
 *
 */
function buildRoute(route, name, destPath, templates, partials, lang, opts){
 	destPath = path.join(destPath, name);

  return renderPage(route, name, templates, partials, 'en', opts).then(function(assets){
    return fs.mkdirpAsync(destPath).then(function(){
      var files = [];
      if(assets.html){
        //
        // Render index.html
        //
        files.push(fs.writeFileAsync(path.join(destPath, 'index.html'), assets.html));
      }
      if(assets.css){
        files.push(fs.writeFileAsync(path.join(destPath, name+'.css'), assets.css));
      }
      return Promise.all(files);
    });
  }).then(function(){
      //
      // Copy/Preprocess Assets (css, jpeg, etc).
      //
      var assets = [].concat(route.__img || [], route.__css || [], route.__js || []);
      return Promise.map(assets, function(asset){
        // var processor = getPreprocessor(asset);
        return fs.copyAsync(asset, path.join(destPath, path.basename(asset)) );
      });

  }).then(function(){
    return Promise.map(_.sortBy(_.filter(_.keys(route), notContent)), function (key){
	     return buildRoute(route[key], key, destPath, templates, partials, lang, opts);
    });
  });
}

function getPreprocessor( filename, destPath ){
  var mimeType = mime.lookup(filename);
  var fileDestPath = path.join(destPath, path.basename(filename));

  var engine = engines[mimeType];
  if(engine){
    return fs.readFileAsync( filename, 'utf8' ).then(function (data){
      return engine.render( data );
    }).then(function(data){
      return fs.outputFileAsync(fileDestPath, data, 'utf8');
    });
  }else{
    return fs.copyAsync(filename, fileDestPath);
  }
}

function registerPartials(partials){
  _.each(partials, function(partial, name){
    _.each(partial, function( content, mimeType){
      var engine = engines[mimeType];
      if(engine){
        engine.register && engine.register(name, content);
      }else{
        console.log('marlin: warning: missing template engine for type:', mimeType);
      }
    });
  });
}

function notContent(item){
  return ['__content', '__css', '__img', '__js'].indexOf(item) === -1;
}

function renderPage(page, name, templates, partials, language, opts) {

  //
  // load content file
  //
  var files = [];
  _.each(page.__content, function (filename) {
    var components = path.basename(filename).split('.');
    var templateName = components[0];
    var lang = opts.defaultLanguage;

    if (components.length === 3) {
      lang = components[1];
    }

    var template = templates[templateName];
    if (_.isUndefined(template)) {
      throw Error('Missing template: ' + templateName)
    }

    var mimeType = mime.lookup(filename);

    var supported = ['text/x-markdown', 'application/json', 'text/plain'];

    if (lang === language && supported.indexOf(mimeType) !== -1  ) {
	     files.push({
        filename: filename,
	      template: template,
        lang: lang,
        mimeType: mimeType
      })
    }
  });

  //
  // Try to get the language file, otherwise pick the default language one
  //
  var contentFile = _.find(files, { lang: language });
  if (!contentFile) {
    contentFile = files[0];
  }

  if (!contentFile) {
     console.log('marlin: warning:', 'missing content file for page: ' + name);
     return Promise.resolve('');
  }

  return readContentFile( contentFile.filename ).then(function (view) {
    var assets = {};
    _.extend(view, site, {$page: name});
    _.each(contentFile.template, function(content, mimeType){
      var engine = engines[mimeType];

      if(engine){
        assets[engine.ext] = engine.render(content, view, partials);
      }else{
        console.log("marlin: warning: missing render engine for type:", mimeType);
      }
    });

    return assets;
  });
}

function readContentFile( filename ){
  var dataPromise;
  if(_.isObject(filename)){
    dataPromise = Promise.resolve(filename);
  }else{
    dataPromise = fs.readFileAsync(filename, 'utf8').then(function (data) {
      return {
        content: data,
        mimeType: mime.lookup(filename)
      }
    });
  }

  return dataPromise.then(function(data){
    switch(data.mimeType){
      case 'text/plain':
        return parseContent( data.content, noPreprocess );
      case 'text/x-markdown':
        return parseContent( data.content, marked );
      case 'application/json':
        try{
          return JSON.parse( data.content );
        }catch(err){
          console.log("marlin: error parsing content: ", filename);
        }
        break;
    }
  });
}

function noPreprocess(data){
  return data;
}

function parseContent(content, preprocessor) {

  var properties = {};
  var re = /((.[^:\s])+):/g
  var lines = content.split('\n')

  var contentRanges = [];

  for (var i = 0; i < lines.length; i++) {
    var line = lines[i];
    if ( line.match(re)) {
      contentRanges.push({
        property: line.substr(0, line.length - 1),
	      start: i + 1
      });
    }
  }

  for (var j = 0; j < contentRanges.length; j++) {
    var end = j + 1 < contentRanges.length ? contentRanges[j + 1].start : lines.length;
    var value = lines.slice(contentRanges[j].start, end).join();
	  properties[contentRanges[j].property] = preprocessor(value);
  }

	 return properties;
}

//
// Load all the files in a given directory with proper mimetype mappings.
//
function loadFiles(_path) {
  var files = {};
  return fs.readdirAsync(_path).map(function (filename) {
    var subpath = path.join(_path, filename);
    return fs.statAsync(subpath).then(function (stat) {
      if (stat.isFile()) {
         return fs.readFileAsync(subpath, 'utf8').then(function (data) {
          var templateName = filename.split('.')[0];

          files[templateName] = files[templateName] || {};
          files[templateName][mime.lookup(filename)] = data;

        });
      }
    });
  }).then(function(){
    return files;
  })
}
