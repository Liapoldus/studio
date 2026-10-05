# Core API adapters

Будущая инфраструктурная граница для HTTPS Management API Core. Direct-клиент
и SSH-bridge клиент должны реализовывать domain port `interfaces.CoreAPI`.
Сетевые вызовы, TLS verification и токены не должны попадать в React или domain.

Адаптеры пока не реализованы: API surface, credential lifecycle и SSH policy
будут определены отдельным срезом.
