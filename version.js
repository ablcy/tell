const VERSION = {
    major: 5,
    minor: 9,
    patch: 16,
    build: '20260515',
    toString: function() {
        return `v${this.major}.${this.minor}.${this.patch}`;
    },
    full: function() {
        return `${this.toString()}-${this.build}`;
    }
};

if (typeof module !== 'undefined' && module.exports) {
    module.exports = VERSION;
}
