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
 *
 */

/*
1) Read the templates.
2) Traverse home to create all the routes into an object.
3) Render every route in the build directory (using the templates, partials, etc.).
*/

var Promise = require('bluebird');
var _ = require('lodash');
var mkdirp = Promise.promisify(require('mkdirp'));
var fs = require('fs');
var path = require('path');
var mustache = require('mustache');

Promise.promisifyAll(fs);

function build(src, dst) {
  return createRoutes(path.join(src, 'home')).then(function (routes) {
	   return renderRoutes(
      routes,
      path.join(src, 'templates'),
      path.join(src, 'partials'),
      dst, {
        defaultLanguage: 'en'
      });
  });
}

build('test', 'test/build').then(function (site) {
  //console.log(site);
});

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
        routes['__content'] = routes['__content'] ||  [];
        routes['__content'].push(subpath);
      }
    });
  }).then(function () {
    return routes;
  });
}

// TODO: refactor loadFiles code
function loadFiles(_path) {
  var files = {};
  return fs.readdirAsync(_path).map(function (filename) {
    var subpath = path.join(_path, filename);
    return fs.statAsync(subpath).then(function (stat) {
      if (stat.isFile()) {
	       return fs.readFileAsync(subpath, 'utf8').then(function (data) {
          var templateName = filename.split('.')[0];
          files[templateName] = data;
        });
      }
    });
  }).then(function(){
    return files;
  })
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
  return renderRoute(route, name, templates, partials, 'en', opts).then(function(index){
    return mkdirp(destPath).then(function(){
      return fs.writeFileAsync(path.join(destPath, 'index.html'), index);
    }).then(function(){
      return Promise.map(_.sortBy(_.filter(_.keys(route), notContent)), function (key){
	       return buildRoute(route[key], key, destPath, templates, partials, lang, opts);
      });
    });
  });
}

function renderRoutes(routes, templatesPath, partialsPath, destPath, opts) {
  // Get languages list
  var languages = ['en', 'se', 'es', 'de']; // TODO: convert into a function

  return Promise.join(loadFiles(templatesPath), loadFiles(partialsPath)).spread(function (templates, partials){
    return buildRoute(routes, 'home', destPath, templates, partials, languages[0], opts);
  });
}


function notContent(item){
  return item !== '__content';
}

function renderRoute(route, name, templates, partials, language, opts) {
  var view = {};

  //
  // load content file
  //
  var files = [];
  _.each(route.__content, function (filename) {
    var components = path.basename(filename).split('.');
    var templateName = components[0];
    var lang = opts.defaultLanguage;
    var ext;

    if (components.length === 3) {
      lang = components[1];
      ext = components[2];
    } else {
      ext = components[1];
    }

    var template = templates[templateName];
    if (_.isUndefined(template)) {
      throw Error('Missing template: ' + templateName)
    }

    if (lang === language && ext === 'md') {
	     files.push({
        filename: filename,
	       template: template,
        lang: lang,
        ext: ext
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
     console.log('marlin: warning:', 'missing content file for route: ' + name);
     return Promise.resolve('');
  }

  return fs.readFileAsync(contentFile.filename, 'utf8').then(function (data) {
    _.extend(view, parseContent(data));
  }).then(function () {
	   return mustache.render(contentFile.template, view, partials);
  });
}

function parseContent(content) {

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
	   properties[contentRanges[j].property] = lines.slice(contentRanges[j].start, end);
  }

	 return properties;
}

function createFile(dst, content){

}