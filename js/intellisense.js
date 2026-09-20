// ============================================================
// intellisense.js - Rich snippet library for every supported
// language (basic to advanced) + diagnostics configuration so
// relative imports don't get flagged as errors.
// ============================================================

export function setupIntelliSense(monacoNS) {
  // Turn off semantic validation for JS/TS (unresolved imports, types)
  // while keeping syntax validation (real typos are still flagged).
  monacoNS.languages.typescript.javascriptDefaults.setDiagnosticsOptions({
    noSemanticValidation: true,
    noSyntaxValidation: false,
  });
  monacoNS.languages.typescript.typescriptDefaults.setDiagnosticsOptions({
    noSemanticValidation: true,
    noSyntaxValidation: false,
  });
  monacoNS.languages.typescript.javascriptDefaults.setCompilerOptions({
    target: monacoNS.languages.typescript.ScriptTarget.ES2020,
    allowNonTsExtensions: true,
    moduleResolution: monacoNS.languages.typescript.ModuleResolutionKind.NodeJs,
    module: monacoNS.languages.typescript.ModuleKind.ESNext,
    allowJs: true,
  });

  registerHtmlSnippets(monacoNS);
  registerJsSnippets(monacoNS);
  registerSimpleSnippets(monacoNS, ['css', 'scss', 'less'], CSS_SNIPPETS);
  registerSimpleSnippets(monacoNS, ['python'], PYTHON_SNIPPETS);
  registerSimpleSnippets(monacoNS, ['json'], JSON_SNIPPETS);
  registerSimpleSnippets(monacoNS, ['markdown'], MARKDOWN_SNIPPETS);
  registerSimpleSnippets(monacoNS, ['shell'], SHELL_SNIPPETS);
  registerSimpleSnippets(monacoNS, ['sql'], SQL_SNIPPETS);
  registerSimpleSnippets(monacoNS, ['php'], PHP_SNIPPETS);
  registerSimpleSnippets(monacoNS, ['java'], JAVA_SNIPPETS);
  registerSimpleSnippets(monacoNS, ['c'], C_SNIPPETS);
  registerSimpleSnippets(monacoNS, ['cpp'], CPP_SNIPPETS);
  registerSimpleSnippets(monacoNS, ['csharp'], CSHARP_SNIPPETS);
  registerSimpleSnippets(monacoNS, ['go'], GO_SNIPPETS);
  registerSimpleSnippets(monacoNS, ['rust'], RUST_SNIPPETS);
  registerSimpleSnippets(monacoNS, ['ruby'], RUBY_SNIPPETS);
  registerSimpleSnippets(monacoNS, ['yaml'], YAML_SNIPPETS);
  registerSimpleSnippets(monacoNS, ['kotlin'], KOTLIN_SNIPPETS);
  registerSimpleSnippets(monacoNS, ['swift'], SWIFT_SNIPPETS);
  registerSimpleSnippets(monacoNS, ['dart'], DART_SNIPPETS);
}

function snippetRange(model, position) {
  const word = model.getWordUntilPosition(position);
  return {
    startLineNumber: position.lineNumber,
    endLineNumber: position.lineNumber,
    startColumn: word.startColumn,
    endColumn: word.endColumn,
  };
}

// ---------------- Generic helper for registering simple snippets ----------------

function registerSimpleSnippets(monacoNS, languages, items) {
  languages.forEach((lang) => {
    monacoNS.languages.registerCompletionItemProvider(lang, {
      provideCompletionItems(model, position) {
        const range = snippetRange(model, position);
        return {
          suggestions: items.map((it) => ({
            label: it.label,
            kind: monacoNS.languages.CompletionItemKind.Snippet,
            documentation: it.doc,
            insertText: it.text,
            insertTextRules: monacoNS.languages.CompletionItemInsertTextRule.InsertAsSnippet,
            range,
          })),
        };
      },
    });
  });
}

// ---------------- HTML (with emmet-like '!' trigger) ----------------

function registerHtmlSnippets(monacoNS) {
  const html5 = [
    '<!DOCTYPE html>',
    '<html lang="en">',
    '<head>',
    '\t<meta charset="UTF-8">',
    '\t<meta name="viewport" content="width=device-width, initial-scale=1.0">',
    '\t<title>${1:Document}</title>',
    '</head>',
    '<body>',
    '\t${2}',
    '</body>',
    '</html>',
  ].join('\n');

  monacoNS.languages.registerCompletionItemProvider('html', {
    triggerCharacters: [':', '!'],
    provideCompletionItems(model, position) {
      const range = snippetRange(model, position);
      return {
        suggestions: [
          { label: 'html:5', kind: monacoNS.languages.CompletionItemKind.Snippet, documentation: 'Basic HTML5 boilerplate', insertText: html5, insertTextRules: monacoNS.languages.CompletionItemInsertTextRule.InsertAsSnippet, range },
          { label: '!', kind: monacoNS.languages.CompletionItemKind.Snippet, documentation: 'Basic HTML5 boilerplate (emmet)', insertText: html5, insertTextRules: monacoNS.languages.CompletionItemInsertTextRule.InsertAsSnippet, range },
          ...HTML_SNIPPETS.map((it) => ({
            label: it.label, kind: monacoNS.languages.CompletionItemKind.Snippet, documentation: it.doc,
            insertText: it.text, insertTextRules: monacoNS.languages.CompletionItemInsertTextRule.InsertAsSnippet, range,
          })),
        ],
      };
    },
  });
}

const HTML_SNIPPETS = [
  { label: 'a', text: '<a href="${1:#}">${2:link text}</a>', doc: 'Anchor link' },
  { label: 'img', text: '<img src="${1:image.png}" alt="${2:description}">', doc: 'Image' },
  { label: 'link-css', text: '<link rel="stylesheet" href="${1:style.css}">', doc: 'Stylesheet link' },
  { label: 'script-src', text: '<script src="${1:script.js}"></script>', doc: 'External script' },
  { label: 'form', text: '<form action="${1:#}" method="${2:post}">\n\t${3}\n\t<button type="submit">${4:Submit}</button>\n</form>', doc: 'Form' },
  { label: 'input', text: '<input type="${1:text}" name="${2:name}" placeholder="${3:placeholder}">', doc: 'Input field' },
  { label: 'table', text: '<table>\n\t<thead>\n\t\t<tr><th>${1:Header}</th></tr>\n\t</thead>\n\t<tbody>\n\t\t<tr><td>${2:Cell}</td></tr>\n\t</tbody>\n</table>', doc: 'Table skeleton' },
  { label: 'ul-li', text: '<ul>\n\t<li>${1:Item}</li>\n</ul>', doc: 'Unordered list' },
  { label: 'meta-viewport', text: '<meta name="viewport" content="width=device-width, initial-scale=1.0">', doc: 'Responsive viewport meta tag' },
  { label: 'video', text: '<video src="${1:video.mp4}" controls></video>', doc: 'Video player' },
];

// ---------------- JS / TS ----------------

function registerJsSnippets(monacoNS) {
  ['javascript', 'typescript'].forEach((lang) => {
    monacoNS.languages.registerCompletionItemProvider(lang, {
      provideCompletionItems(model, position) {
        const range = snippetRange(model, position);
        return {
          suggestions: JS_SNIPPETS.map((it) => ({
            label: it.label,
            kind: monacoNS.languages.CompletionItemKind.Snippet,
            documentation: it.doc,
            insertText: it.text,
            insertTextRules: monacoNS.languages.CompletionItemInsertTextRule.InsertAsSnippet,
            range,
          })),
        };
      },
    });
  });
}

const JS_SNIPPETS = [
  { label: 'cl', text: 'console.log(${1});', doc: 'console.log()' },
  { label: 'cw', text: 'console.warn(${1});', doc: 'console.warn()' },
  { label: 'ce', text: 'console.error(${1});', doc: 'console.error()' },
  { label: 'func', text: 'function ${1:name}(${2}) {\n\t${3}\n}', doc: 'Declared function' },
  { label: 'afn', text: 'const ${1:name} = (${2}) => {\n\t${3}\n};', doc: 'Arrow function' },
  { label: 'iife', text: '(function () {\n\t${1}\n})();', doc: 'Immediately invoked function expression' },
  { label: 'imp', text: "import { ${1} } from '${2:module}';", doc: 'Named import' },
  { label: 'impd', text: "import ${1:name} from '${2:module}';", doc: 'Default import' },
  { label: 'exp', text: 'export function ${1:name}(${2}) {\n\t${3}\n}', doc: 'Export function' },
  { label: 'expd', text: 'export default ${1:value};', doc: 'Default export' },
  { label: 'fetch', text: "fetch('${1:url}')\n\t.then(res => res.json())\n\t.then(data => {\n\t\t${2}\n\t})\n\t.catch(err => console.error(err));", doc: 'Fetch API' },
  { label: 'fetchasync', text: "async function ${1:fetchData}() {\n\ttry {\n\t\tconst res = await fetch('${2:url}');\n\t\tconst data = await res.json();\n\t\t${3}\n\t} catch (err) {\n\t\tconsole.error(err);\n\t}\n}", doc: 'Async fetch with try/catch' },
  { label: 'try', text: 'try {\n\t${1}\n} catch (err) {\n\tconsole.error(err);\n}', doc: 'try/catch' },
  { label: 'trycf', text: 'try {\n\t${1}\n} catch (err) {\n\tconsole.error(err);\n} finally {\n\t${2}\n}', doc: 'try/catch/finally' },
  { label: 'foreach', text: '${1:array}.forEach((${2:item}) => {\n\t${3}\n});', doc: 'Array.forEach' },
  { label: 'map', text: 'const ${1:result} = ${2:array}.map((${3:item}) => {\n\treturn ${4};\n});', doc: 'Array.map' },
  { label: 'filter', text: 'const ${1:result} = ${2:array}.filter((${3:item}) => ${4:condition});', doc: 'Array.filter' },
  { label: 'reduce', text: 'const ${1:result} = ${2:array}.reduce((${3:acc}, ${4:item}) => {\n\treturn ${3:acc};\n}, ${5:0});', doc: 'Array.reduce' },
  { label: 'class', text: 'class ${1:Name} {\n\tconstructor(${2}) {\n\t\t${3}\n\t}\n}', doc: 'Class' },
  { label: 'classext', text: 'class ${1:Name} extends ${2:Base} {\n\tconstructor(${3}) {\n\t\tsuper(${4});\n\t\t${5}\n\t}\n}', doc: 'Class extending another' },
  { label: 'promise', text: 'new Promise((resolve, reject) => {\n\t${1}\n});', doc: 'New Promise' },
  { label: 'settimeout', text: 'setTimeout(() => {\n\t${1}\n}, ${2:1000});', doc: 'setTimeout' },
  { label: 'setinterval', text: 'setInterval(() => {\n\t${1}\n}, ${2:1000});', doc: 'setInterval' },
  { label: 'ternary', text: '${1:condition} ? ${2:valueIfTrue} : ${3:valueIfFalse}', doc: 'Ternary operator' },
  { label: 'destr', text: 'const { ${1:prop} } = ${2:object};', doc: 'Object destructuring' },
  { label: 'destrarr', text: 'const [${1:a}, ${2:b}] = ${3:array};', doc: 'Array destructuring' },
  { label: 'spread', text: 'const ${1:copy} = { ...${2:original} };', doc: 'Spread operator (object)' },
  { label: 'jsonparse', text: 'JSON.parse(${1:jsonString})', doc: 'JSON.parse' },
  { label: 'jsonstr', text: 'JSON.stringify(${1:value})', doc: 'JSON.stringify' },
  { label: 'addlistener', text: "${1:element}.addEventListener('${2:click}', (e) => {\n\t${3}\n});", doc: 'addEventListener' },
  { label: 'qsel', text: "document.querySelector('${1:.selector}')", doc: 'querySelector' },
  { label: 'qselall', text: "document.querySelectorAll('${1:.selector}')", doc: 'querySelectorAll' },
  // React (works fine in .jsx/.tsx recognized as javascript/typescript)
  { label: 'rfc', text: "import React from 'react';\n\nexport default function ${1:ComponentName}(${2:props}) {\n\treturn (\n\t\t<div>\n\t\t\t${3}\n\t\t</div>\n\t);\n}", doc: 'React functional component' },
  { label: 'useState', text: 'const [${1:state}, set${2:State}] = useState(${3:initialValue});', doc: 'React useState hook' },
  { label: 'useEffect', text: 'useEffect(() => {\n\t${1}\n}, [${2}]);', doc: 'React useEffect hook' },
];

// ---------------- Python ----------------

const PYTHON_SNIPPETS = [
  { label: 'def', text: 'def ${1:name}(${2}):\n\t${3:pass}', doc: 'Define a function' },
  { label: 'deft', text: 'def ${1:name}(${2}) -> ${3:None}:\n\t${4:pass}', doc: 'Function with type hint' },
  { label: 'class', text: 'class ${1:Name}:\n\tdef __init__(self, ${2}):\n\t\t${3:pass}', doc: 'Define a class' },
  { label: 'classinherit', text: 'class ${1:Name}(${2:Base}):\n\tdef __init__(self, ${3}):\n\t\tsuper().__init__(${4})\n\t\t${5:pass}', doc: 'Class inheriting from another' },
  { label: 'main', text: 'def main():\n\t${1:pass}\n\n\nif __name__ == "__main__":\n\tmain()', doc: 'main() entry point' },
  { label: 'for', text: 'for ${1:item} in ${2:iterable}:\n\t${3:pass}', doc: 'for loop' },
  { label: 'while', text: 'while ${1:condition}:\n\t${2:pass}', doc: 'while loop' },
  { label: 'ifmain', text: 'if __name__ == "__main__":\n\t${1:pass}', doc: '__main__ guard' },
  { label: 'trycatch', text: 'try:\n\t${1:pass}\nexcept ${2:Exception} as e:\n\t${3:print(e)}', doc: 'try/except' },
  { label: 'trycatchfinally', text: 'try:\n\t${1:pass}\nexcept ${2:Exception} as e:\n\t${3:print(e)}\nfinally:\n\t${4:pass}', doc: 'try/except/finally' },
  { label: 'withopen', text: "with open('${1:file.txt}', '${2:r}') as f:\n\t${3:content = f.read()}", doc: 'Open a file with context manager' },
  { label: 'lcomp', text: '[${1:x} for ${1:x} in ${2:iterable}]', doc: 'List comprehension' },
  { label: 'dcomp', text: '{${1:k}: ${2:v} for ${1:k}, ${2:v} in ${3:iterable}}', doc: 'Dict comprehension' },
  { label: 'lambda', text: 'lambda ${1:x}: ${2:x}', doc: 'Lambda expression' },
  { label: 'decorator', text: 'def ${1:decorator_name}(func):\n\tdef wrapper(*args, **kwargs):\n\t\t${2:pass}\n\t\treturn func(*args, **kwargs)\n\treturn wrapper', doc: 'Function decorator' },
  { label: 'dataclass', text: 'from dataclasses import dataclass\n\n\n@dataclass\nclass ${1:Name}:\n\t${2:field}: ${3:str}', doc: '@dataclass' },
  { label: 'property', text: '@property\ndef ${1:name}(self):\n\treturn self._${1:name}', doc: '@property getter' },
  { label: 'staticmethod', text: '@staticmethod\ndef ${1:name}(${2}):\n\t${3:pass}', doc: '@staticmethod' },
  { label: 'argparse', text: "import argparse\n\nparser = argparse.ArgumentParser()\nparser.add_argument('--${1:arg}', type=${2:str}, help='${3:help text}')\nargs = parser.parse_args()", doc: 'argparse setup' },
];

// ---------------- CSS / SCSS / LESS ----------------

const CSS_SNIPPETS = [
  { label: 'flex', text: 'display: flex;\nalign-items: center;\njustify-content: ${1:center};', doc: 'Basic flexbox' },
  { label: 'flexcol', text: 'display: flex;\nflex-direction: column;\ngap: ${1:16px};', doc: 'Flex column with gap' },
  { label: 'grid', text: 'display: grid;\ngrid-template-columns: ${1:repeat(3, 1fr)};\ngap: ${2:16px};', doc: 'Basic grid' },
  { label: 'gridarea', text: 'display: grid;\ngrid-template-areas:\n\t"${1:header header}"\n\t"${2:sidebar main}";', doc: 'Grid with named areas' },
  { label: 'center-abs', text: 'position: absolute;\ntop: 50%;\nleft: 50%;\ntransform: translate(-50%, -50%);', doc: 'Absolute centering' },
  { label: 'media', text: '@media (max-width: ${1:768px}) {\n\t${2}\n}', doc: 'Media query' },
  { label: 'anim', text: '@keyframes ${1:name} {\n\tfrom { ${2} }\n\tto { ${3} }\n}', doc: 'Keyframes animation' },
  { label: 'transition', text: 'transition: ${1:all} ${2:0.2s} ${3:ease};', doc: 'Transition' },
  { label: 'boxshadow', text: 'box-shadow: ${1:0 2px 8px} rgba(0, 0, 0, ${2:0.15});', doc: 'Box shadow' },
  { label: 'gradient', text: 'background: linear-gradient(${1:to right}, ${2:#000}, ${3:#fff});', doc: 'Linear gradient' },
  { label: 'import', text: "@import url('${1:file.css}');", doc: 'Import CSS file' },
  { label: 'fontface', text: "@font-face {\n\tfont-family: '${1:Name}';\n\tsrc: url('${2:font.woff2}') format('woff2');\n}", doc: '@font-face' },
  { label: 'var', text: '--${1:name}: ${2:value};', doc: 'CSS custom property' },
  { label: 'varuse', text: 'var(--${1:name})', doc: 'Use CSS custom property' },
  { label: 'reset', text: '* {\n\tmargin: 0;\n\tpadding: 0;\n\tbox-sizing: border-box;\n}', doc: 'Basic CSS reset' },
];

// ---------------- JSON ----------------

const JSON_SNIPPETS = [
  { label: 'pkg', text: '{\n\t"name": "${1:project}",\n\t"version": "1.0.0",\n\t"scripts": {\n\t\t"start": "${2:node index.js}"\n\t}\n}', doc: 'package.json skeleton' },
  { label: 'tsconfig', text: '{\n\t"compilerOptions": {\n\t\t"target": "${1:ES2020}",\n\t\t"module": "${2:ESNext}",\n\t\t"strict": true\n\t}\n}', doc: 'tsconfig.json skeleton' },
];

// ---------------- Markdown ----------------

const MARKDOWN_SNIPPETS = [
  { label: 'link', text: '[${1:text}](${2:url})', doc: 'Link' },
  { label: 'img', text: '![${1:alt}](${2:url})', doc: 'Image' },
  { label: 'code', text: '```${1:js}\n${2}\n```', doc: 'Code block' },
  { label: 'table', text: '| ${1:Col1} | ${2:Col2} |\n| --- | --- |\n| ${3} | ${4} |', doc: 'Table' },
  { label: 'h1', text: '# ${1:Title}', doc: 'Heading 1' },
  { label: 'h2', text: '## ${1:Title}', doc: 'Heading 2' },
  { label: 'checklist', text: '- [ ] ${1:Task}', doc: 'Checklist item' },
  { label: 'quote', text: '> ${1:Quote}', doc: 'Blockquote' },
  { label: 'badge', text: '![${1:label}](https://img.shields.io/badge/${1:label}-${2:value}-${3:blue})', doc: 'Shields.io badge' },
];

// ---------------- Shell / Bash ----------------

const SHELL_SNIPPETS = [
  { label: 'shebang', text: '#!/usr/bin/env bash\n\n${1}', doc: 'Bash shebang' },
  { label: 'iff', text: 'if [ ${1:condition} ]; then\n\t${2}\nfi', doc: 'if conditional' },
  { label: 'ifelse', text: 'if [ ${1:condition} ]; then\n\t${2}\nelse\n\t${3}\nfi', doc: 'if/else conditional' },
  { label: 'forloop', text: 'for ${1:item} in ${2:list}; do\n\t${3}\ndone', doc: 'for loop' },
  { label: 'whileloop', text: 'while [ ${1:condition} ]; do\n\t${2}\ndone', doc: 'while loop' },
  { label: 'func', text: '${1:function_name}() {\n\t${2}\n}', doc: 'Function' },
  { label: 'args', text: 'if [ "$#" -ne ${1:1} ]; then\n\techo "Usage: $0 ${2:<arg>}"\n\texit 1\nfi', doc: 'Argument count check' },
  { label: 'readvar', text: 'read -p "${1:Prompt}: " ${2:var}', doc: 'Read user input' },
];

// ---------------- SQL ----------------

const SQL_SNIPPETS = [
  { label: 'select', text: 'SELECT ${1:*}\nFROM ${2:table}\nWHERE ${3:condition};', doc: 'SELECT' },
  { label: 'selectjoin', text: 'SELECT ${1:*}\nFROM ${2:table_a} a\nJOIN ${3:table_b} b ON a.${4:id} = b.${5:a_id};', doc: 'SELECT with JOIN' },
  { label: 'insert', text: 'INSERT INTO ${1:table} (${2:columns})\nVALUES (${3:values});', doc: 'INSERT' },
  { label: 'update', text: 'UPDATE ${1:table}\nSET ${2:column} = ${3:value}\nWHERE ${4:condition};', doc: 'UPDATE' },
  { label: 'delete', text: 'DELETE FROM ${1:table}\nWHERE ${2:condition};', doc: 'DELETE' },
  { label: 'create', text: 'CREATE TABLE ${1:table} (\n\t${2:id} INT PRIMARY KEY,\n\t${3}\n);', doc: 'CREATE TABLE' },
  { label: 'alter', text: 'ALTER TABLE ${1:table}\nADD COLUMN ${2:column} ${3:VARCHAR(255)};', doc: 'ALTER TABLE' },
  { label: 'groupby', text: 'SELECT ${1:column}, COUNT(*)\nFROM ${2:table}\nGROUP BY ${1:column};', doc: 'GROUP BY' },
  { label: 'index', text: 'CREATE INDEX ${1:idx_name} ON ${2:table} (${3:column});', doc: 'CREATE INDEX' },
];

// ---------------- PHP ----------------

const PHP_SNIPPETS = [
  { label: 'phpopen', text: '<?php\n${1}\n?>', doc: 'PHP opening tag' },
  { label: 'func', text: 'function ${1:name}(${2}) {\n\t${3}\n}', doc: 'Function' },
  { label: 'class', text: 'class ${1:Name} {\n\tpublic function __construct(${2}) {\n\t\t${3}\n\t}\n}', doc: 'Class' },
  { label: 'foreach', text: 'foreach (${1:$array} as ${2:$item}) {\n\t${3}\n}', doc: 'foreach loop' },
  { label: 'trycatch', text: 'try {\n\t${1}\n} catch (${2:Exception} $e) {\n\t${3:echo $e->getMessage();}\n}', doc: 'try/catch' },
  { label: 'if', text: 'if (${1:condition}) {\n\t${2}\n}', doc: 'if statement' },
  { label: 'require', text: "require_once '${1:file.php}';", doc: 'require_once' },
  { label: 'arrow', text: 'fn(${1:$x}) => ${2:$x}', doc: 'Arrow function' },
];

// ---------------- Java ----------------

const JAVA_SNIPPETS = [
  { label: 'main', text: 'public static void main(String[] args) {\n\t${1}\n}', doc: 'main method' },
  { label: 'class', text: 'public class ${1:Name} {\n\t${2}\n}', doc: 'Public class' },
  { label: 'sout', text: 'System.out.println(${1});', doc: 'System.out.println()' },
  { label: 'method', text: 'public ${1:void} ${2:methodName}(${3}) {\n\t${4}\n}', doc: 'Method' },
  { label: 'forloop', text: 'for (int ${1:i} = 0; ${1:i} < ${2:n}; ${1:i}++) {\n\t${3}\n}', doc: 'for loop' },
  { label: 'foreach', text: 'for (${1:Type} ${2:item} : ${3:collection}) {\n\t${4}\n}', doc: 'Enhanced for loop' },
  { label: 'trycatch', text: 'try {\n\t${1}\n} catch (${2:Exception} e) {\n\t${3:e.printStackTrace();}\n}', doc: 'try/catch' },
  { label: 'interface', text: 'public interface ${1:Name} {\n\t${2}\n}', doc: 'Interface' },
  { label: 'getter-setter', text: 'public ${1:String} get${2:Name}() {\n\treturn ${3:field};\n}\n\npublic void set${2:Name}(${1:String} ${3:field}) {\n\tthis.${3:field} = ${3:field};\n}', doc: 'Getter and setter' },
];

// ---------------- C ----------------

const C_SNIPPETS = [
  { label: 'main', text: '#include <stdio.h>\n\nint main() {\n\t${1}\n\treturn 0;\n}', doc: 'Main program' },
  { label: 'for', text: 'for (int ${1:i} = 0; ${1:i} < ${2:n}; ${1:i}++) {\n\t${3}\n}', doc: 'for loop' },
  { label: 'struct', text: 'typedef struct {\n\t${1}\n} ${2:Name};', doc: 'typedef struct' },
  { label: 'func', text: '${1:int} ${2:name}(${3}) {\n\t${4}\n}', doc: 'Function' },
  { label: 'printf', text: 'printf("${1:%s}\\n", ${2});', doc: 'printf' },
  { label: 'malloc', text: '${1:int} *${2:ptr} = malloc(${3:sizeof(int)});', doc: 'malloc' },
];

// ---------------- C++ ----------------

const CPP_SNIPPETS = [
  { label: 'main', text: '#include <iostream>\nusing namespace std;\n\nint main() {\n\t${1}\n\treturn 0;\n}', doc: 'Main program' },
  { label: 'cout', text: 'cout << ${1} << endl;', doc: 'Console output' },
  { label: 'class', text: 'class ${1:Name} {\npublic:\n\t${1:Name}(${2}) {\n\t\t${3}\n\t}\nprivate:\n\t${4}\n};', doc: 'Class' },
  { label: 'vector', text: 'vector<${1:int}> ${2:name};', doc: 'std::vector declaration' },
  { label: 'for', text: 'for (int ${1:i} = 0; ${1:i} < ${2:n}; ${1:i}++) {\n\t${3}\n}', doc: 'for loop' },
];

// ---------------- C# ----------------

const CSHARP_SNIPPETS = [
  { label: 'main', text: 'class Program {\n\tstatic void Main(string[] args) {\n\t\t${1}\n\t}\n}', doc: 'Main program' },
  { label: 'cw', text: 'Console.WriteLine(${1});', doc: 'Console.WriteLine()' },
  { label: 'class', text: 'public class ${1:Name} {\n\tpublic ${1:Name}(${2}) {\n\t\t${3}\n\t}\n}', doc: 'Class' },
  { label: 'prop', text: 'public ${1:string} ${2:Name} { get; set; }', doc: 'Auto-property' },
  { label: 'foreach', text: 'foreach (var ${1:item} in ${2:collection}) {\n\t${3}\n}', doc: 'foreach loop' },
  { label: 'trycatch', text: 'try {\n\t${1}\n} catch (${2:Exception} ex) {\n\t${3:Console.WriteLine(ex.Message);}\n}', doc: 'try/catch' },
];

// ---------------- Go ----------------

const GO_SNIPPETS = [
  { label: 'main', text: 'package main\n\nimport "fmt"\n\nfunc main() {\n\t${1}\n}', doc: 'Main program' },
  { label: 'func', text: 'func ${1:name}(${2}) ${3} {\n\t${4}\n}', doc: 'Function' },
  { label: 'iferr', text: 'if err != nil {\n\t${1:return err}\n}', doc: 'Error handling' },
  { label: 'struct', text: 'type ${1:Name} struct {\n\t${2:Field} ${3:string}\n}', doc: 'Struct' },
  { label: 'method', text: 'func (${1:r} ${2:Receiver}) ${3:MethodName}(${4}) ${5} {\n\t${6}\n}', doc: 'Method with receiver' },
  { label: 'goroutine', text: 'go func() {\n\t${1}\n}()', doc: 'Goroutine' },
  { label: 'forrange', text: 'for ${1:i}, ${2:v} := range ${3:collection} {\n\t${4}\n}', doc: 'for range loop' },
];

// ---------------- Rust ----------------

const RUST_SNIPPETS = [
  { label: 'main', text: 'fn main() {\n\t${1}\n}', doc: 'main function' },
  { label: 'fn', text: 'fn ${1:name}(${2}) -> ${3:()} {\n\t${4}\n}', doc: 'Function' },
  { label: 'println', text: 'println!("${1}");', doc: 'Print to console' },
  { label: 'struct', text: 'struct ${1:Name} {\n\t${2:field}: ${3:String},\n}', doc: 'Struct' },
  { label: 'impl', text: 'impl ${1:Name} {\n\tfn ${2:new}(${3}) -> Self {\n\t\t${4}\n\t}\n}', doc: 'impl block' },
  { label: 'match', text: 'match ${1:value} {\n\t${2:pattern} => ${3},\n\t_ => ${4},\n}', doc: 'match expression' },
  { label: 'forloop', text: 'for ${1:item} in ${2:iterable} {\n\t${3}\n}', doc: 'for loop' },
];

// ---------------- Ruby ----------------

const RUBY_SNIPPETS = [
  { label: 'def', text: 'def ${1:name}(${2})\n\t${3}\nend', doc: 'Define a method' },
  { label: 'class', text: 'class ${1:Name}\n\tdef initialize(${2})\n\t\t${3}\n\tend\nend', doc: 'Define a class' },
  { label: 'each', text: '${1:array}.each do |${2:item}|\n\t${3}\nend', doc: 'Iterate with each' },
  { label: 'if', text: 'if ${1:condition}\n\t${2}\nend', doc: 'if statement' },
  { label: 'unless', text: 'unless ${1:condition}\n\t${2}\nend', doc: 'unless statement' },
  { label: 'attr', text: 'attr_accessor :${1:name}', doc: 'attr_accessor' },
];

// ---------------- YAML ----------------

const YAML_SNIPPETS = [
  { label: 'service', text: '${1:service}:\n  image: ${2:image}\n  ports:\n    - "${3:8080}:${4:80}"', doc: 'docker-compose service' },
  { label: 'githubaction', text: 'name: ${1:CI}\non: [push]\njobs:\n  ${2:build}:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@v4', doc: 'GitHub Actions workflow' },
];

// ---------------- Kotlin ----------------

const KOTLIN_SNIPPETS = [
  { label: 'main', text: 'fun main() {\n\t${1}\n}', doc: 'main function' },
  { label: 'fun', text: 'fun ${1:name}(${2}): ${3:Unit} {\n\t${4}\n}', doc: 'Function' },
  { label: 'class', text: 'class ${1:Name}(${2}) {\n\t${3}\n}', doc: 'Class with primary constructor' },
  { label: 'dataclass', text: 'data class ${1:Name}(val ${2:field}: ${3:String})', doc: 'Data class' },
];

// ---------------- Swift ----------------

const SWIFT_SNIPPETS = [
  { label: 'func', text: 'func ${1:name}(${2}) -> ${3:Void} {\n\t${4}\n}', doc: 'Function' },
  { label: 'class', text: 'class ${1:Name} {\n\tinit(${2}) {\n\t\t${3}\n\t}\n}', doc: 'Class' },
  { label: 'struct', text: 'struct ${1:Name} {\n\t${2}\n}', doc: 'Struct' },
  { label: 'print', text: 'print(${1})', doc: 'Print to console' },
];

// ---------------- Dart ----------------

const DART_SNIPPETS = [
  { label: 'main', text: 'void main() {\n\t${1}\n}', doc: 'main function' },
  { label: 'class', text: 'class ${1:Name} {\n\t${1:Name}(${2});\n}', doc: 'Class' },
  { label: 'widget', text: 'class ${1:Name} extends StatelessWidget {\n\t@override\n\tWidget build(BuildContext context) {\n\t\treturn ${2:Container()};\n\t}\n}', doc: 'Flutter StatelessWidget' },
];
