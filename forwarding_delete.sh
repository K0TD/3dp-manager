#!/usr/bin/env bash
set -euo pipefail

#################################
# TRAP
#################################
trap 'echo -e "\033[1;31m[ERROR]\033[0m Ошибка в строке $LINENO"; exit 1' ERR

#################################
# HELPERS
#################################
log() { echo -e "\033[1;32m[INFO]\033[0m $1"; }
warn() { echo -e "\033[1;33m[WARN]\033[0m $1"; }

[[ $EUID -eq 0 ]] || { echo "Запускать нужно от root"; exit 1; }

#################################
# UFW NAT CLEAN
#################################
echo "--- Удаление перенаправления ---"
rm -f /etc/sysctl.d/99-relay-optimization.conf
sysctl net.ipv4.ip_forward=0

echo "--- Восстановление правил UFW из бэкапа ---"
if [ -f /etc/ufw/before.rules.bak ]; then
    mv /etc/ufw/before.rules.bak /etc/ufw/before.rules
    echo "Файл before.rules восстановлен из бэкапа."
else
    echo "ВНИМАНИЕ: Бэкап before.rules.bak не найден. Правила NAT придется удалять вручную."
fi

echo "--- Удаление разрешающих правил портов ---"
if [[ -f /etc/3dp-manager-forwarding-ports ]]; then
    while IFS= read -r entry; do
        [[ -n $entry ]] || continue
        ufw delete allow "$entry" || true
    done < /etc/3dp-manager-forwarding-ports
    rm -f /etc/3dp-manager-forwarding-ports
else
    for entry in 443/tcp 443/udp 8443/tcp 8443/udp 10000:60000/tcp 10000:60000/udp; do
        ufw delete allow "$entry" || true
    done
fi

echo "--- Возврат политики FORWARD по умолчанию (DROP) ---"
sed -i 's/DEFAULT_FORWARD_POLICY="ACCEPT"/DEFAULT_FORWARD_POLICY="DROP"/' /etc/default/ufw

echo "--- Перезапуск фаервола ---"
ufw reload

#################################
# RESULT
#################################

echo "UFW NAT очищен"
echo "ip_forward отключён"
log "Откат завершён. Для окончательного применения изменений система будет перезагружена!"

(sleep 3 && reboot) >/dev/null 2>&1 &

exit 0