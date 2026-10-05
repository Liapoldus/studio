# SSH bridge adapter

Зарезервированная инфраструктурная граница для необязательного SSH-моста к
Management API Core. Выбор между direct и bridge задаётся настройкой отдельного
Core connection. Реализация туннеля, проверка server identity и управление
credential намеренно отложены до проектирования безопасного connection flow.
