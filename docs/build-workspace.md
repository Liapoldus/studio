# Build workspace removed

Service build wizard удалён как breaking change. Studio работает с готовыми
бинарниками и не собирает service binaries, Docker images или supervisor.

Разработка выполняется во внешнем SDK toolchain. В Studio бинарник проходит
только регистрацию и trust flow в разделе `Artifacts`, после чего может быть
запущен локально в Docker через CLI/Core control plane.

```text
external SDK build → liapoldus service artifact register/trust
                   → runtime start
                   → Core-backed manifest/config/readiness
```

Temporary runtime staging не записывается в Project или Git. Для build/release
артефактов используются SDK, service repository и CI; Studio показывает только
их provenance и runtime diagnostics.
