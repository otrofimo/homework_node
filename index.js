'use strict'

const requestPromise = require('request-promise');
const request = require('request'); 

const cheerio = require('cheerio');
const Promise = require('bluebird');

const tar = require('tar');
const fs = require('fs-extra');
const path = require('path');

const dependedURI = "https://www.npmjs.com/browse/depended";
const packageURI = "https://registry.npmjs.org/";
const perPageCount = 36; // results per page
const PACKAGE_DIR = path.resolve(__dirname, 'packages');

// Currently page scraping, depending on system requirements might just want
// to replicate CouchDB (https://skimdb.npmjs.com/registry/_all_docs)
// However, the memory requirements are ~980mb to download the graph so seems excessive

function downloadPackages (count=process.env.COUNT, callback= ()=> {console.log("DONE!")} ) {
  clearDirectory()
    .then(() => fetchDependedPackages(count))
    .then((responses) => parsePackages(responses, count))
    .then(installAllPackages)
    .then( _ => callback())
    .catch(logError)
}

function clearDirectory() {
  return fs.emptyDir(PACKAGE_DIR)
}

function fetchDependedPackages(count) {
  // number of requests we will need to make
  let requestCount = Math.ceil(count / perPageCount);
  let responsePromises = [];

  for(var i = 0 ; i < requestCount; i++) {
    var offset = i * perPageCount;
    console.log("Fetching page : ", dependedURI+ "?offset=" + offset);
    responsePromises.push(requestPromise(dependedURI+ "?offset=" + offset));
  };

  return Promise.all(responsePromises);
}

function parsePackages(responses, count) {
  return responses.reduce((accum, html) => {
    var parsedPackages = parseHTMLForPackage(html);
    return accum.concat(parsedPackages);
  }, []).slice(0,count);
}

function parseHTMLForPackage(response) {
  var $ = cheerio.load(response);
  return $('h3 a').map((_, node) => {
    return node.firstChild.data;
  }).toArray();
}

function installAllPackages(packages) {
  return Promise.all(
    packages.map((packageName) => {
      return fetchPackage(packageName)
        .then(tarURI => {
          console.log(path.resolve(PACKAGE_DIR, packageName));
          return extractTarToDir(tarURI, path.resolve(PACKAGE_DIR, packageName));
        })
        .catch(() => { logError("Can't find: " + packageName)})
    })
  )
}

function fetchPackage(name) {
  var registryURI = '';
  if (isScopedPackage(name)) {
    registryURI = 'https://registry.npmjs.org/' + "@" + encodeURIComponent(name.slice(1));
  } else {
    registryURI = 'https://registry.npmjs.org/' + name;
  }

  return requestPromise(registryURI)
    .then((response) => {
      var response = JSON.parse(response);
      var version = response['dist-tags'].latest
      return response.versions[version].dist.tarball;
    });
}

function isScopedPackage(string) {
  return string.match(/@/);
}

function extractTarToDir(tarURI, location) {
  console.log("Extracting ", tarURI, " to : ", location)
  return new Promise((resolve, reject) => {
    fs.mkdirs(location, (err) => {
      if (err) {
        console.error("ERROR mkdir");
        reject(err);
      }

      request(tarURI)
      .pipe(tar.x({
        strip: 1,
        cwd: location
       }))
      .on('close', resolve)
      .on('error', (err) => {
        console.log("TAR error", err);
        reject(err)
      })
    });
  })
};

function logError(err) {
  console.log("*".repeat(60));
  console.log("ERROR", err);
  console.log("*".repeat(60));
}

module.exports = downloadPackages
