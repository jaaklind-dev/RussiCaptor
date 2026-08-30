// Native SQLite localStorage installation is an application bootstrap side effect.
// Jest tests provide their own storage state and must not open a native database.
export {};
