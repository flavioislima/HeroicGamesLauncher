module.exports = {
  contextSeparator: '_',
  // Key separator used in your translation keys

  createOldCatalogs: false,
  // Save the \_old files

  customValueTemplate: null,
  // If you wish to customize the value output the value as an object, you can set your own format.
  // ${defaultValue} is the default value you set in your translation function.
  // Any other custom property will be automatically extracted.
  //
  // Example:
  // {
  //   message: "${defaultValue}",
  //   description: "${maxLength}", // t('my-key', {maxLength: 150})
  // }

  defaultNamespace: 'translation',
  // Default namespace used in your i18next config

  defaultValue: '',
  // Default value to give to empty keys

  failOnWarnings: false,
  // Exit with an exit code of 1 on warnings

  indentation: 4,
  // Indentation of the catalog files

  input: ['src/**/*.{ts,tsx}', 'electron/**/*.{ts,tsx}'],
  // An array of globs that describe where to look for source files
  // relative to the location of the configuration file

  keepRemoved: false,
  // Keep keys from the catalog that are no longer in code

  keySeparator: '.',
  // Key separator used in your translation keys
  // If you want to use plain english keys, separators such as `.` and `:` will conflict. You might want to set `keySeparator: false` and `namespaceSeparator: false`. That way, `t('Status: Loading...')` will not think that there are a namespace and three separator dots for instance.

  // see below for more details
  lexers: {
    ts: ['JavascriptLexer'],
    tsx: [
      {
        attr: 'i18nKey', // Attribute for the keys
        lexer: 'JsxLexer'
      }
    ]
  },

  lineEnding: 'auto',
  // Control the line ending. See options at https://github.com/ryanve/eol

  locales: ['de', 'el', 'en', 'es', 'fr', 'nl', 'pl', 'pt', 'ru', 'ca', 'cs', 'tr', 'hu', 'it', 'ml', 'sv', 'zh_Hans'],
  // An array of the locales in your applications

  namespaceSeparator: ':',
  // Namespace separator used in your translation keys
  // If you want to use plain english keys, separators such as `.` and `:` will conflict. You might want to set `keySeparator: false` and `namespaceSeparator: false`. That way, `t('Status: Loading...')` will not think that there are a namespace and three separator dots for instance.

  output: 'public/locales/$LOCALE/$NAMESPACE.json',
  // Supports $LOCALE and $NAMESPACE injection
  // Supports JSON (.json) and YAML (.yml) file formats
  // Where to write the locale files relative to process.cwd()

  skipDefaultValues: false,
  // Whether to ignore default values.

  sort: true,
  // Whether or not to sort the catalog

  useKeysAsDefaultValue: false,
  // Whether to use the keys as the default value; ex. "Hello": "Hello", "World": "World"
  // This option takes precedence over the `defaultValue` and `skipDefaultValues` options

  verbose: true
  // Display info about the parsing including some stat
}
