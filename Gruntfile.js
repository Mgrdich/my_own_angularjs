module.exports = function (grunt) {
    grunt["initConfig"]({

        jshint: {
            all: ['src/**/*.js', 'test/**/*.js'],
            options: {
                globals: {
                    _: false,
                    $: false,
                    jest: false,
                    describe: false,
                    it: false,
                    expect: false,
                    beforeEach: false,
                    afterEach: false,
                    sinon: false
                },
                browser: true,
                devel: true
            }
        },
    });
    grunt.loadNpmTasks('grunt-contrib-jshint');
};