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
        run : {
            yarn_test_jest: {
                exec: 'yarn test' // <-- use the exec key.
            }
        }
    });
    grunt.loadNpmTasks('grunt-contrib-jshint');
    grunt.loadNpmTasks('grunt-run');
    grunt.registerTask('default', [ 'run:yarn_test_jest']);
};