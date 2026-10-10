# Git и управление версиями

## 1. Роль Git в Studio

Каждый Studio Project является корнем одного локального Git repository. Local
versioning всегда включено и обязательно. Studio предоставляет полноценную
работу с версиями, но Git отвечает только за исходные файлы проекта, а не за
runtime SQLite Core.

Удалённый remote подключается отдельно. После подключения он может быть объявлен
источником истины проекта. Studio не должна отправлять изменения в protected
remote без выполненной provider/CI approval policy.

## 2. Version Control page — production first scope

Отдельная страница `Version Control` содержит:

- repository root и redacted remote list;
- active branch и safe branch switcher для clean working tree;
- bounded commit history и file-level diff;
- staged, unstaged, untracked и conflicted files;
- commit editor для project-scoped changes;
- pull/push controls для выбранного remote/branch;
- policy/approval status перед push.

Merge, rebase, cherry-pick, stash, partial staging, provider metadata и
интерактивный conflict resolver остаются CLI/external-editor workflows до
утверждения отдельного versioned Git operations contract. Studio уже фиксирует
conflict state и блокирует опасные действия.

## 3. Revision gate

Любой deployable revision — существующий commit. Незакоммиченный working tree
можно редактировать и валидировать, но нельзя передать в `liapoldus apply`.
Studio должна явно разделять:

```text
Draft → Validated → Committed → Pushed/Approved → Deployable
```

`push` не означает deploy. Deploy выполняется CLI для явно выбранного target и
commit SHA.

## 4. Remotes

Поддерживаются несколько remotes. Для каждого отображаются:

- name и URL без credential values;
- fetch/push URLs;
- default branch;
- auth method reference;
- last fetch/push result;
- policy status.

Credentials хранятся в OS credential manager, SSH agent или CI secret provider.
Они не попадают в project manifest, `.studio` source, logs или plugin payloads.

## 5. Branch workflow

Studio должна поддерживать полный branch workflow:

- checkout/switch с защитой от потери drafts;
- create from branch/tag/commit;
- delete local branch и request remote deletion при наличии прав;
- merge с preview и conflict state;
- rebase с явным предупреждением о переписывании history;
- cherry-pick с commit selection и conflict state;
- stash для временного сохранения drafts;
- восстановление после прерванной операции.

Операции, меняющие remote или переписывающие history, требуют explicit
confirmation и показывают exact remote/branch/commit scope.

## 6. Commit UI

Commit dialog показывает staged file list, diff, validation problems и связь с
project/environment. Commit message обязателен. Amend разрешён только для
локального commit и должен явно предупреждать, если revision уже pushed или
использовалась в deploy report.

## 7. Conflict resolver

При конфликте Studio сохраняет Git conflict state, показывает base/ours/theirs,
результирующий файл и validation diagnostics. Нельзя создать deployable commit,
пока все conflicts не разрешены и проект не прошёл local validation.

## 8. Связь с CLI

Studio не содержит Core API adapter. После commit пользователь может запустить
CLI вручную или передать commit в CI:

```bash
liapoldus plan --project ./project --revision <sha> --target production
liapoldus apply --project ./project --revision <sha> --target production
```

CLI возвращает report с `commit SHA → bundle digest → operation ID → generation`.
Studio может импортировать report и показать его рядом с commit, но не может
подделать runtime state.
