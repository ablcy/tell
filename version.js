const VERSION = {
    major: 5,
    minor: 9,
    patch: 56,
    build: '202605191530',
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
