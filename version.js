const VERSION = {
    major: 5,
    minor: 9,
    patch: 67,
    build: '202605201430',
    full: function() {
        return `v${this.major}.${this.minor}.${this.patch}`;
    },
    fullWithBuild: function() {
        return `v${this.major}.${this.minor}.${this.patch} ${this.build}`;
    },
    npmVersion: function() {
        return `${this.major}.${this.minor}.${this.patch}`;
    }
};

if (typeof module !== 'undefined' && module.exports) {
    module.exports = VERSION;
}
