#!/usr/bin/env bash
set -euo pipefail

#################################
# TRAP
#################################
trap 'echo -e "\033[1;31m[ERROR]\033[0m Ошибка в строке $LINENO"; exit 1' ERR

#################################
# HELPERS
#################################
log()  { echo -e "\033[1;32m[INFO]\033[0m $1"; }
warn() { echo -e "\033[1;33m[WARN]\033[0m $1"; }
die()  { echo -e "\033[1;31m[ERROR]\033[0m $1"; exit 1; }

resolve_compose_cmd() {
  if docker compose version >/dev/null 2>&1; then
    COMPOSE_CMD=("docker" "compose")
    return 0
  fi

  if command -v docker-compose >/dev/null 2>&1; then
    COMPOSE_CMD=("docker-compose")
    return 0
  fi

  die "Не найден Docker Compose (ни v2 plugin, ни v1 binary)"
}

check_containers_running() {
  log "Проверка статуса контейнеров..."
  local timeout=${1:-60}
  local elapsed=0
  local failed=0

  while [ $elapsed -lt $timeout ]; do
    failed=0
    # Формат: NAME\tSTATUS (например: "3dp-postgres\tUp 2 days" или "3dp-postgres\tError")
    while IFS=$'\t' read -r container_name status; do
      if [ -n "$container_name" ] && [ -n "$status" ]; then
        # Restarting означает, что контейнер не смог стабильно запуститься.
        if ! echo "$status" | grep -qiE "^up|running|healthy"; then
          failed=1
          warn "Контейнер $container_name в статусе: $status"
        fi
      fi
    done < <("${COMPOSE_CMD[@]}" ps --format "table {{.Name}}\t{{.Status}}" --all 2>/dev/null | tail -n +2)

    if [ $failed -eq 0 ]; then
      log "Все контейнеры запущены успешно"
      return 0
    fi

    sleep 2
    elapsed=$((elapsed + 2))
  done

  return 1
}

check_and_fix_credentials() {
  log "Проверка учётных данных на безопасность..."

  local env_file=".env"
  local credentials_changed=0

  # Проверяем, существует ли .env файл
  if [[ ! -f "$env_file" ]]; then
    log "Создание .env файла с безопасными учётными данными..."

    # Генерируем случайные пароли
    local db_pass
    local jwt_secret
    local admin_login
    local admin_pass

    db_pass=$(openssl rand -base64 12 | tr -dc 'A-Za-z0-9' | cut -c1-12)
    jwt_secret=$(openssl rand -base64 32)
    admin_login=$(openssl rand -base64 8 | tr -dc 'A-Za-z0-9' | cut -c1-8)
    admin_pass=$(openssl rand -base64 12 | tr -dc 'A-Za-z0-9' | cut -c1-12)

    # Создаём .env файл
    cat > "$env_file" <<EOF
POSTGRES_USER=admin
POSTGRES_PASSWORD=${db_pass}
POSTGRES_DB=3dp_manager
JWT_SECRET=${jwt_secret}
ADMIN_LOGIN=${admin_login}
ADMIN_PASSWORD=${admin_pass}
PORT=3100
LOG_LEVEL=error
ALLOWED_ORIGINS=
EOF

    credentials_changed=1
  else
    # Проверяем, не используются ли дефолтные значения
    local admin_login_val
    local admin_pass_val
    local jwt_secret_val
    local db_pass_val

    admin_login_val=$(grep -E "^ADMIN_LOGIN=" "$env_file" 2>/dev/null | cut -d'=' -f2 | tr -d '"' | tr -d "'" || echo "")
    admin_pass_val=$(grep -E "^ADMIN_PASSWORD=" "$env_file" 2>/dev/null | cut -d'=' -f2 | tr -d '"' | tr -d "'" || echo "")
    jwt_secret_val=$(grep -E "^JWT_SECRET=" "$env_file" 2>/dev/null | cut -d'=' -f2 | tr -d '"' | tr -d "'" || echo "")
    db_pass_val=$(grep -E "^POSTGRES_PASSWORD=" "$env_file" 2>/dev/null | cut -d'=' -f2 | tr -d '"' | tr -d "'" || echo "")

    local needs_update=0

    if [[ "$admin_login_val" == "admin" ]] || [[ -z "$admin_login_val" ]]; then
      warn "Обнаружен дефолтный ADMIN_LOGIN=admin"
      needs_update=1
    fi

    if [[ "$admin_pass_val" == "admin" ]] || [[ -z "$admin_pass_val" ]]; then
      warn "Обнаружен дефолтный ADMIN_PASSWORD=admin"
      needs_update=1
    fi

    if [[ "$jwt_secret_val" == "secretKey" ]] || [[ -z "$jwt_secret_val" ]]; then
      warn "Обнаружен дефолтный JWT_SECRET=secretKey"
      needs_update=1
    fi

    if [[ "$db_pass_val" == "admin" ]] || [[ -z "$db_pass_val" ]]; then
      warn "Обнаружен дефолтный POSTGRES_PASSWORD=admin"
      needs_update=1
    fi

    if [[ $needs_update -eq 1 ]]; then
      log "Генерация новых безопасных учётных данных..."

      # Генерируем новые пароли
      local new_db_pass
      local new_jwt_secret
      local new_admin_login
      local new_admin_pass

      new_db_pass=$(openssl rand -base64 12 | tr -dc 'A-Za-z0-9' | cut -c1-12)
      new_jwt_secret=$(openssl rand -base64 32)
      new_admin_login=$(openssl rand -base64 8 | tr -dc 'A-Za-z0-9' | cut -c1-8)
      new_admin_pass=$(openssl rand -base64 12 | tr -dc 'A-Za-z0-9' | cut -c1-12)

      # Сохраняем существующие значения, которые не нужно менять
      local existing_postgres_user
      existing_postgres_user=$(grep -E "^POSTGRES_USER=" "$env_file" 2>/dev/null | cut -d'=' -f2 || echo "admin")

      # Создаём новый .env файл
      cat > "$env_file" <<EOF
POSTGRES_USER=${existing_postgres_user:-admin}
POSTGRES_PASSWORD=${new_db_pass}
POSTGRES_DB=3dp_manager
JWT_SECRET=${new_jwt_secret}
ADMIN_LOGIN=${new_admin_login}
ADMIN_PASSWORD=${new_admin_pass}
EOF

      credentials_changed=1
    else
      log "Учётные данные безопасны ✅"
    fi
  fi

  return $credentials_changed
}

ensure_nginx_api_timeouts() {
  local nginx_conf="$1"
  [[ -f "$nginx_conf" ]] || return 0

  local tmp_file
  tmp_file="$(mktemp)"

  awk '
    BEGIN { in_api = 0; in_bus = 0; injected = 0 }
    {
      line = $0

      if (line ~ /^[[:space:]]*location[[:space:]]+\/api\/[[:space:]]*\{/) {
        in_api = 1
        in_bus = 0
        injected = 0
      }

      if (line ~ /^[[:space:]]*location[[:space:]]+\/bus\/[[:space:]]*\{/) {
        in_bus = 1
        in_api = 0
        injected = 0
      }

      if ((in_api || in_bus) && line ~ /proxy_(connect|send|read)_timeout[[:space:]]+[0-9]+s;/) {
        next
      }

      print line

      if ((in_api || in_bus) && line ~ /proxy_set_header[[:space:]]+X-Forwarded-For[[:space:]]+/ && injected == 0) {
        print "        proxy_connect_timeout 10s;"
        print "        proxy_send_timeout 650s;"
        print "        proxy_read_timeout 650s;"
        injected = 1
      }

      if ((in_api || in_bus) && line ~ /^[[:space:]]*}/) {
        in_api = 0
        in_bus = 0
        injected = 0
      }
    }
  ' "$nginx_conf" > "$tmp_file"

  mv "$tmp_file" "$nginx_conf"
}

ensure_bus_location() {
  local nginx_conf="$1"
  [[ -f "$nginx_conf" ]] || return 0

  # Проверяем, есть ли уже location /bus/
  if grep -q "location /bus/" "$nginx_conf"; then
    return 0
  fi

  local tmp_file
  tmp_file="$(mktemp)"

  awk '
    {
      print $0
      if ($0 ~ /^[[:space:]]*location[[:space:]]+\/api\//) {
        found_api = 1
      }
      if (found_api && $0 ~ /^[[:space:]]*\}/) {
        print ""
        print "    location /bus/ {"
        print "        proxy_pass http://backend:3100/bus/;"
        print "        proxy_set_header Host $http_host;"
        print "        proxy_set_header X-Real-IP $remote_addr;"
        print "        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;"
        print "        proxy_connect_timeout 10s;"
        print "        proxy_send_timeout 650s;"
        print "        proxy_read_timeout 650s;"
        print "    }"
        found_api = 0
      }
    }
  ' "$nginx_conf" > "$tmp_file"

  mv "$tmp_file" "$nginx_conf"
}

remove_hysteria_mount() {
  local compose_file="$1"
  [[ -f "$compose_file" ]] || return 0

  local tmp_file
  tmp_file="$(mktemp)"

  awk '
    /^[[:space:]]*volumes:[[:space:]]*$/ {
      pending_volumes = $0
      next
    }

    /\/etc\/hysteria\/config\.yaml:\/etc\/hysteria\/config\.yaml:ro/ {
      pending_volumes = ""
      next
    }

    {
      if (pending_volumes != "") {
        print pending_volumes
        pending_volumes = ""
      }
      print $0
    }

    END {
      if (pending_volumes != "") print pending_volumes
    }
  ' "$compose_file" > "$tmp_file"

  mv "$tmp_file" "$compose_file"
}

ensure_safe_database_mode() {
  local compose_file="$1"
  [[ -f "$compose_file" ]] || return 0

  local tmp_file
  tmp_file="$(mktemp)"

  awk '
    /^[[:space:]]+DB_SYNCHRONIZE:/ { next }
    /^[[:space:]]+DB_MIGRATIONS_RUN:/ { next }
    {
      print $0
      if ($0 ~ /^[[:space:]]+DB_NAME:/) {
        match($0, /^[[:space:]]+/)
        indent = substr($0, RSTART, RLENGTH)
        print indent "DB_SYNCHRONIZE: \"false\""
        print indent "DB_MIGRATIONS_RUN: \"true\""
      }
    }
  ' "$compose_file" > "$tmp_file"

  mv "$tmp_file" "$compose_file"
}

ensure_docker_logging() {
  local compose_file="$1"
  [[ -f "$compose_file" ]] || return 0

  local tmp_file
  tmp_file="$(mktemp)"

  awk '
    function flush_logging() {
      if (in_services && current_service != "" && !has_logging) {
        print "    logging:"
        print "      driver: json-file"
        print "      options:"
        print "        max-size: \"10m\""
        print "        max-file: \"3\""
      }
    }
    function flush_blanks() {
      for (i = 0; i < blank_count; i++) print blanks[i]
      blank_count = 0
    }
    /^[^[:space:]#][^:]*:/ {
      flush_logging()
      flush_blanks()
      current_service = ""
      has_logging = 0
      in_services = ($0 ~ /^services:[[:space:]]*$/) ? 1 : 0
      print $0
      next
    }
    in_services && /^  [a-zA-Z0-9_-]+:[[:space:]]*$/ {
      flush_logging()
      flush_blanks()
      current_service = $1
      sub(/:$/, "", current_service)
      has_logging = 0
      print $0
      next
    }
    in_services && /^[[:space:]]*$/ {
      blanks[blank_count++] = $0
      next
    }
    {
      flush_blanks()
      if (in_services && current_service != "" && $0 ~ /^    logging:/) {
        has_logging = 1
      }
      print $0
    }
    END {
      flush_logging()
      flush_blanks()
    }
  ' "$compose_file" > "$tmp_file"

  mv "$tmp_file" "$compose_file"
}

ensure_postgres_resilience() {
  local compose_file="$1"
  [[ -f "$compose_file" ]] || return 0

  local tmp_file
  tmp_file="$(mktemp)"

  awk '
    function flush_postgres() {
      if (in_services && in_postgres && !has_stop_grace) {
        print "    stop_grace_period: 30s"
      }
    }
    function flush_blanks() {
      for (i = 0; i < blank_count; i++) print blanks[i]
      blank_count = 0
    }
    /^[^[:space:]#][^:]*:/ {
      flush_postgres()
      flush_blanks()
      in_postgres = 0
      in_healthcheck = 0
      has_stop_grace = 0
      in_services = ($0 ~ /^services:[[:space:]]*$/) ? 1 : 0
      print $0
      next
    }
    in_services && /^  [a-zA-Z0-9_-]+:[[:space:]]*$/ {
      flush_postgres()
      flush_blanks()
      in_postgres = ($1 == "postgres:") ? 1 : 0
      in_healthcheck = 0
      has_stop_grace = 0
      print $0
      next
    }
    in_services && in_postgres && /^[[:space:]]*$/ {
      blanks[blank_count++] = $0
      next
    }
    {
      flush_blanks()
      if (in_services && in_postgres) {
        if ($0 ~ /^    stop_grace_period:/) {
          has_stop_grace = 1
        }
        if ($0 ~ /^    healthcheck:[[:space:]]*$/) {
          in_healthcheck = 1
        } else if ($0 ~ /^    [a-zA-Z0-9_-]+:/) {
          in_healthcheck = 0
        }
        if (in_healthcheck && $0 ~ /^      retries:[[:space:]]*5[[:space:]]*$/) {
          print "      retries: 12"
          next
        }
      }
      print $0
    }
    END {
      flush_postgres()
      flush_blanks()
    }
  ' "$compose_file" > "$tmp_file"

  mv "$tmp_file" "$compose_file"
}

check_disk_space() {
  local min_required_mb=256
  local warn_threshold_mb=1024
  local paths=("$PROJECT_DIR")
  if [[ -d /var/lib/docker ]]; then
    paths+=("/var/lib/docker")
  fi

  local target avail_mb
  for target in "${paths[@]}"; do
    avail_mb=$(df -Pm "$target" 2>/dev/null | awk 'NR==2 {print $4}')
    if [[ ! "$avail_mb" =~ ^[0-9]+$ ]]; then
      continue
    fi
    if (( avail_mb < min_required_mb )); then
      die "Недостаточно свободного места на диске для $target (доступно ${avail_mb}MB, требуется минимум ${min_required_mb}MB). Освободите место (например: docker system prune -f, проверьте размер логов в /var/lib/docker/containers и $PROJECT_DIR/backups) и повторите обновление."
    fi
    if (( avail_mb < warn_threshold_mb )); then
      warn "Мало свободного места на диске для $target: ${avail_mb}MB (рекомендуется >= ${warn_threshold_mb}MB)"
    fi
  done
}

wait_for_postgres() {
  local timeout=${1:-60}
  local elapsed=0

  log "Ожидание готовности PostgreSQL..."
  while [ "$elapsed" -lt "$timeout" ]; do
    if docker exec 3dp-postgres sh -c 'pg_isready -U "$POSTGRES_USER" -d "$POSTGRES_DB"' >/dev/null 2>&1; then
      return 0
    fi
    sleep 2
    elapsed=$((elapsed + 2))
  done

  return 1
}

prune_old_backups() {
  local backup_dir="$PROJECT_DIR/backups"
  local keep="${1:-10}"
  [[ -d "$backup_dir" ]] || return 0

  local old_backups=()
  mapfile -t old_backups < <(
    find "$backup_dir" -maxdepth 1 -type f -name 'pre-update-*.sql.gz' -printf '%T@ %p\n' 2>/dev/null \
      | sort -rn \
      | tail -n +"$((keep + 1))" \
      | cut -d' ' -f2- || true
  )

  if [[ ${#old_backups[@]} -gt 0 ]]; then
    rm -f "${old_backups[@]}"
    log "Удалено устаревших резервных копий: ${#old_backups[@]} (оставлены последние $keep)"
  fi
}

switch_to_k0td_images() {
  local compose_file="$1"
  [[ -f "$compose_file" ]] || return 0
  sed -i \
    -e 's#ghcr.io/denpiligrim/3dp-manager-server:[^[:space:]]*#ghcr.io/k0td/3dp-manager-server:stable#g' \
    -e 's#ghcr.io/denpiligrim/3dp-manager-client:[^[:space:]]*#ghcr.io/k0td/3dp-manager-client:stable#g' \
    -e 's#ghcr.io/k0td/3dp-manager-server:[^[:space:]]*#ghcr.io/k0td/3dp-manager-server:stable#g' \
    -e 's#ghcr.io/k0td/3dp-manager-client:[^[:space:]]*#ghcr.io/k0td/3dp-manager-client:stable#g' \
    -e 's#^\([[:space:]]*image:[[:space:]]*\)3dp-manager-server:local[[:space:]]*$#\1ghcr.io/k0td/3dp-manager-server:stable#' \
    -e 's#^\([[:space:]]*image:[[:space:]]*\)3dp-manager-client:local[[:space:]]*$#\1ghcr.io/k0td/3dp-manager-client:stable#' \
    -e '/^[[:space:]]*build:[[:space:]]*\.\/source\/\(server\|client\)[[:space:]]*$/d' \
    "$compose_file"
}

prepare_local_build_fallback() {
  local compose_file="$PROJECT_DIR/docker-compose.yml"
  local source_dir="$PROJECT_DIR/source"
  local download_dir
  local compose_tmp

  download_dir="$(mktemp -d)"
  compose_tmp="$(mktemp)"

  warn "GHCR недоступен. Загружаю исходники K0TD для локальной сборки..."
  if ! curl -fsSL https://github.com/k0td/3dp-manager/archive/refs/heads/main.tar.gz \
    | tar -xz -C "$download_dir" --strip-components=1; then
    rm -rf "$download_dir"
    rm -f "$compose_tmp"
    die "Не удалось загрузить исходники K0TD"
  fi

  [[ -f "$download_dir/server/Dockerfile" ]] || die "В архиве отсутствует server/Dockerfile"
  [[ -f "$download_dir/client/Dockerfile" ]] || die "В архиве отсутствует client/Dockerfile"

  rm -rf "$source_dir"
  mkdir -p "$source_dir"
  cp -a "$download_dir/server" "$source_dir/server"
  cp -a "$download_dir/client" "$source_dir/client"
  rm -rf "$download_dir"

  awk '
    /^  [a-zA-Z0-9_-]+:[[:space:]]*$/ {
      service = $1
      sub(/:$/, "", service)
    }

    (service == "backend" || service == "frontend") && /^[[:space:]]+(image|build):/ {
      if (!configured[service]) {
        if (service == "backend") {
          print "    image: 3dp-manager-server:local"
          print "    build: ./source/server"
        } else {
          print "    image: 3dp-manager-client:local"
          print "    build: ./source/client"
        }
        configured[service] = 1
      }
      next
    }

    { print }

    END {
      if (!configured["backend"] || !configured["frontend"]) exit 42
    }
  ' "$compose_file" > "$compose_tmp" || {
    rm -f "$compose_tmp"
    die "Не удалось переключить docker-compose.yml на локальную сборку"
  }

  mv "$compose_tmp" "$compose_file"
  log "Локальная сборка backend и frontend..."
  "${COMPOSE_CMD[@]}" build backend frontend
}

pull_images_or_build_locally() {
  if "${COMPOSE_CMD[@]}" pull; then
    log "Образы успешно загружены."
    return 0
  fi

  prepare_local_build_fallback
}

get_node_count() {
  docker exec 3dp-postgres sh -c '
    psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atqc "
      SELECT CASE
        WHEN to_regclass('\''public.node'\'') IS NULL THEN 0
        ELSE (SELECT count(*) FROM node)
      END
    "
  ' 2>/dev/null | tr -d '[:space:]'
}

backup_database() {
  local backup_dir="$PROJECT_DIR/backups"
  BACKUP_FILE="$backup_dir/pre-update-$(date +%Y%m%d-%H%M%S).sql.gz"

  mkdir -p "$backup_dir"
  log "Создание резервной копии базы данных: $BACKUP_FILE"
  docker exec 3dp-postgres sh -c \
    'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB"' | gzip > "$BACKUP_FILE"
  chmod 600 "$BACKUP_FILE"
}

need_root() {
  [[ $EUID -eq 0 ]] || die "Запускать только от root"
}

#################################
# CONFIG
#################################
PROJECT_DIR="/opt/3dp-manager"

#################################
# START
#################################
need_root

log "Обновление 3dp-manager"

[[ -d "$PROJECT_DIR" ]] || die "3dp-manager не установлен ($PROJECT_DIR не найден)"

cd "$PROJECT_DIR"

#################################
# CHECK DOCKER
#################################
command -v docker >/dev/null 2>&1 || die "Docker не установлен"
resolve_compose_cmd
log "Compose команда: ${COMPOSE_CMD[*]}"

#################################
# CHECK AND FIX CREDENTIALS
#################################
# Обновление не должно менять пароль уже инициализированной PostgreSQL:
# изменение только .env делает существующую базу недоступной.
if [[ ! -f ".env" ]]; then
  warn "Корневой .env отсутствует: сохраняю учётные данные из существующего compose без их изменения"
fi

#################################
# CHECK DISK SPACE
#################################
check_disk_space

#################################
# FIX NGINX CONFIG
#################################
ensure_nginx_api_timeouts "$PROJECT_DIR/client/nginx-client.conf"
ensure_bus_location "$PROJECT_DIR/client/nginx-client.conf"
remove_hysteria_mount "$PROJECT_DIR/docker-compose.yml"
ensure_safe_database_mode "$PROJECT_DIR/docker-compose.yml"
ensure_docker_logging "$PROJECT_DIR/docker-compose.yml"
ensure_postgres_resilience "$PROJECT_DIR/docker-compose.yml"
switch_to_k0td_images "$PROJECT_DIR/docker-compose.yml"

#################################
# BACKUP DATABASE
#################################
wait_for_postgres 60 || die "PostgreSQL не принимает подключения (возможно, переполнен диск или идёт восстановление). Проверьте: docker logs 3dp-postgres && df -h"
node_count_before="$(get_node_count)"
[[ "$node_count_before" =~ ^[0-9]+$ ]] || die "Не удалось проверить количество нод перед обновлением"
backup_database
backup_file="$BACKUP_FILE"
[[ -s "$backup_file" ]] || die "Не удалось создать резервную копию базы данных"
prune_old_backups 10

#################################
# REBUILD BACKEND
#################################
log "Скачивание последних версий Docker-образов..."
pull_images_or_build_locally

log "Пересоздание контейнеров..."
"${COMPOSE_CMD[@]}" up -d

# Перезапуск frontend для применения nginx.conf
"${COMPOSE_CMD[@]}" restart frontend

# Проверка: все ли контейнеры запустились
if ! check_containers_running 60; then
    warn "Не удалось запустить контейнеры. Логи:"
    "${COMPOSE_CMD[@]}" logs --tail=50
    die "Обновление прервано из-за ошибки запуска контейнеров"
fi

wait_for_postgres 60 || die "PostgreSQL не готов после обновления. Резервная копия: $backup_file"
node_count_after="$(get_node_count)"
[[ "$node_count_after" =~ ^[0-9]+$ ]] || die "Не удалось проверить количество нод после обновления. Резервная копия: $backup_file"
if (( node_count_after < node_count_before )); then
  "${COMPOSE_CMD[@]}" stop backend || true
  die "Количество нод уменьшилось с $node_count_before до $node_count_after. Обновление остановлено, резервная копия: $backup_file"
fi

log "Очистка старых Docker-образов (освобождение места)..."
docker image prune -f

#################################
# DONE
#################################
log "3dp-manager успешно обновлён ✅"
