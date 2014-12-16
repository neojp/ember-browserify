/* global describe, afterEach, it, expect */

var expect = require('chai').expect;  // jshint ignore:line
var StubGenerator = require('../lib/stub-generator');
var CachingBrowserify = require('../lib/caching-browserify');
var RSVP = require('rsvp');
RSVP.on('error', function(err){throw err;});
var fs = require('fs');
var path = require('path');
var broccoli = require('broccoli');
var quickTemp = require('quick-temp');
var copy = require('copy-dereference').sync;

var src = {};
var builder;

describe('Stub Generator', function() {

  beforeEach(function() {
    quickTemp.makeOrRemake(src, 'tmp');
    src.inputTree = path.join(src.tmp, 'inputTree');
    copy(path.join(__dirname, 'fixtures', 'stubs'), src.inputTree);
  });

  afterEach(function() {
    if (src.tmp) {
      quickTemp.remove(src, 'tmp');
    }
    if (builder) {
      return builder.cleanup();
    }
  });

  it('generates stub file', function() {
    var tree = new StubGenerator(src.inputTree);
    builder = new broccoli.Builder(tree);
    return builder.build().then(function(result) {
      expectFile('browserify_stubs.js').toMatch('first.js').in(result);
    });
  });

  it('adds deps from new file', function() {
    var tree = new StubGenerator(src.inputTree);
    builder = new broccoli.Builder(tree);
    return builder.build().then(function(result) {
      expectFile('browserify_stubs.js').toMatch('first.js').in(result);
      fs.writeFileSync(path.join(src.inputTree, 'new.js'), "import SomethingNew from \"npm:something-new\"\n");
      return builder.build();
    }).then(function(result){
      expectFile('browserify_stubs.js').toMatch('second.js').in(result);
    });
  });

  it('removes deps from deleted file', function() {
    var tree = new StubGenerator(src.inputTree);
    builder = new broccoli.Builder(tree);
    return builder.build().then(function(result) {
      expectFile('browserify_stubs.js').toMatch('first.js').in(result);
      fs.unlinkSync(path.join(src.inputTree, 'sample.js'));
      return builder.build();
    }).then(function(result){
      expectFile('browserify_stubs.js').toMatch('third.js').in(result);
    });
  });

  it('adds deps in modified file', function() {
    var tree = new StubGenerator(src.inputTree);
    builder = new broccoli.Builder(tree);
    return builder.build().then(function(result) {
      expectFile('browserify_stubs.js').toMatch('first.js').in(result);
      var was = fs.readFileSync(path.join(src.inputTree, 'sample.js'));
      was += "\nimport Additional from 'npm:additional-thing';";
      fs.writeFileSync(path.join(src.inputTree, 'sample.js'), was);
      return builder.build();
    }).then(function(result){
      expectFile('browserify_stubs.js').toMatch('fourth.js').in(result);
    });
  });

  it('removes deps in modified file', function() {
    var tree = new StubGenerator(src.inputTree);
    builder = new broccoli.Builder(tree);
    return builder.build().then(function(result) {
      expectFile('browserify_stubs.js').toMatch('first.js').in(result);
      var was = fs.readFileSync(path.join(src.inputTree, 'inner', 'other.js'), 'utf-8');
      was = was.split("\n").slice(1).join("\n");
      fs.writeFileSync(path.join(src.inputTree, 'inner', 'other.js'), was);
      return builder.build();
    }).then(function(result){
      expectFile('browserify_stubs.js').toMatch('fifth.js').in(result);
    });
  });


});


describe('CachingBrowserify', function() {
  beforeEach(function() {
    quickTemp.makeOrRemake(src, 'tmp');
    src.inputTree = path.join(src.tmp, 'inputTree');
    copy(path.join(__dirname, 'fixtures', 'modules'), src.inputTree);
    src.entryTree = path.join(src.inputTree, 'src');
  });

  afterEach(function() {
    if (src.tmp) {
      quickTemp.remove(src, 'tmp');
    }
    if (builder) {
      return builder.cleanup();
    }
  });

  it('builds successfully', function() {
    var tree = new CachingBrowserify(src.entryTree);
    builder = new broccoli.Builder(tree);
    return builder.build().then(function(result){
      expectFile('browserify/browserify.js').toMatch('bundle1.js').in(result);
    });
  });

  it('rebuilds when an npm module changes', function(){
    var tree = new CachingBrowserify(src.entryTree);
    builder = new broccoli.Builder(tree);
    return builder.build().then(function(result){
      expectFile('browserify/browserify.js').toMatch('bundle1.js').in(result);
      var target = path.join(src.inputTree, 'node_modules', 'my-module', 'index.js');
      var code = fs.readFileSync(target, 'utf-8');
      code = code.replace('other.something()', 'other.something()+1');
      fs.writeFileSync(target, code);
      return builder.build();
    }).then(function(result){
      expectFile('browserify/browserify.js').toMatch('bundle2.js').in(result);
    });
  });

  it('rebuilds when the entry file changes', function(){
    var tree = new CachingBrowserify(src.entryTree);
    builder = new broccoli.Builder(tree);
    return builder.build().then(function(result){
      expectFile('browserify/browserify.js').toMatch('bundle1.js').in(result);
      fs.unlinkSync(path.join(src.entryTree, 'browserify_stubs.js'));
      copy(path.join(src.entryTree, 'second_stubs.js'), path.join(src.entryTree, 'browserify_stubs.js'));
      return builder.build();
    }).then(function(result){
      expectFile('browserify/browserify.js').toMatch('bundle3.js').in(result);
    });
  });


});

function expectFile(filename) {
  var stripURL = false;
  var expectedFilename = filename;
  return {
      in: function(result) {
        var actualContent = fs.readFileSync(path.join(result.directory, filename), 'utf-8');
        fs.writeFileSync(path.join(__dirname, 'actual', expectedFilename), actualContent);

        var expectedContent;
        try {
          expectedContent = fs.readFileSync(path.join(__dirname, 'expected', expectedFilename), 'utf-8');
          if (stripURL) {
            expectedContent = expectedContent.replace(/\/\/# sourceMappingURL=.*$/, '');
          }

        } catch (err) {
          console.warn("Missing expcted file: " + path.join(__dirname, 'expected', filename));
        }
        expectSameFiles(actualContent, expectedContent, filename);
        return this;
      },
    notIn: function(result) {
      expect(fs.existsSync(path.join(result.directory, filename))).to.equal(false, filename + ' should not have been present');
      return this;
    },
    toMatch: function(expectedName) {
      expectedFilename = expectedName;
      return this;
    },
    withoutSrcURL: function() {
      stripURL = true;
      return this;
    }
  };
}

function expectSameFiles(actualContent, expectedContent, filename) {
  if (/\.map$/.test(filename)) {
    expect(JSON.parse(actualContent)).to.deep.equal(JSON.parse(expectedContent), 'discrepancy in ' + filename);
  } else {
    expect(actualContent).to.equal(expectedContent, 'discrepancy in ' + filename);
  }
}
