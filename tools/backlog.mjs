#!/usr/bin/env node
// Проекция бэклога: отдаёт ровно то, что нужно шагу цикла, вместо чтения tasks.json целиком.
//
// Файл активного бэклога — 336 КБ (~90k токенов), и команда /backlog перечитывает его перед
// КАЖДОЙ задачей цикла. Для выбора задачи нужны пять полей из девяти, для решений заказчика —
// список ключей. Скрипт не режет tasks.json: структура файла остаётся прежней, меняется только
// способ чтения. Пишущие команды считают meta из данных — счётчики в файлах уже расходились
// с фактом (archived_tasks 73 при 74 задачах).
//
//   node tools/backlog.mjs list                 по строке на задачу (~3 КБ)
//   node tools/backlog.mjs next                 одна рекомендованная задача
//   node tools/backlog.mjs show TASK-137        полное тело одной задачи
//   node tools/backlog.mjs decisions [подстрока] ключи решений; с аргументом — тела совпавших
//   node tools/backlog.mjs start TASK-137       status -> in_progress
//   node tools/backlog.mjs finish TASK-137      перенос в архив + пересчёт счётчиков

import { readFileSync, writeFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const ACTIVE = resolve(ROOT, 'tasks.json')
const ARCHIVE = resolve(ROOT, 'tasks.archive.json')

const PRIORITIES = ['critical', 'high', 'medium', 'low']

const read = (path) => JSON.parse(readFileSync(path, 'utf8'))
// Отступ в два пробела и перевод строки в конце — как в существующих файлах, чтобы правка
// статуса не давала дифф на весь файл.
const write = (path, data) => writeFileSync(path, JSON.stringify(data, null, 2) + '\n')

const fail = (message) => {
  console.error(message)
  process.exit(1)
}

const idNumber = (id) => Number(String(id).replace(/\D/g, '')) || 0

const byPriorityThenId = (a, b) => {
  const p = PRIORITIES.indexOf(a.priority) - PRIORITIES.indexOf(b.priority)
  return p !== 0 ? p : idNumber(a.id) - idNumber(b.id)
}

// Зависимость считается выполненной, если её id отсутствует в активном бэклоге: значит,
// она в архиве. Правило взято из before_start команды /backlog.
const unmetDeps = (task, activeIds) => (task.dependencies ?? []).filter((d) => activeIds.has(d))

const findTask = (tasks, id) => {
  const wanted = String(id).toUpperCase()
  const task = tasks.find((t) => t.id.toUpperCase() === wanted)
  return task ?? fail(`Задача ${id} в tasks.json не найдена. Возможно, она уже в архиве.`)
}

function cmdList() {
  const { tasks } = read(ACTIVE)
  const activeIds = new Set(tasks.map((t) => t.id))
  const counts = {}

  for (const task of [...tasks].sort(byPriorityThenId)) {
    counts[task.status] = (counts[task.status] ?? 0) + 1
    const unmet = unmetDeps(task, activeIds)
    // Готовность — молчанием: помечается только то, что мешает взять задачу.
    const flags = [task.status === 'pending' ? '' : task.status, unmet.length ? `ждёт ${unmet.join(',')}` : '']
      .filter(Boolean)
      .join(' ')
    const head = task.description.replace(/\s+/g, ' ').slice(0, 60)
    console.log(
      `${task.id} ${task.milestone.padEnd(3)} ${task.priority.padEnd(8)} ${head}${flags ? `  [${flags}]` : ''}`,
    )
  }

  const summary = Object.entries(counts)
    .map(([status, n]) => `${status}: ${n}`)
    .join(', ')
  console.log(`\nВсего ${tasks.length} — ${summary}`)

  const running = tasks.filter((t) => t.status === 'in_progress')
  if (running.length) {
    console.log(`ВНИМАНИЕ: в работе висит ${running.map((t) => t.id).join(', ')} — разберись с ней до новой.`)
  }
}

function cmdNext() {
  const { tasks } = read(ACTIVE)
  const activeIds = new Set(tasks.map((t) => t.id))

  const running = tasks.filter((t) => t.status === 'in_progress')
  if (running.length) {
    console.log(`${running[0].id} — уже in_progress, доделай её или верни в pending, новую не бери`)
    return
  }

  const ready = tasks
    .filter((t) => t.status === 'pending' && unmetDeps(t, activeIds).length === 0)
    .sort(byPriorityThenId)

  if (!ready.length) {
    const blocked = tasks.filter((t) => t.status === 'pending').length
    console.log(
      blocked
        ? `Готовых нет: все ${blocked} pending-задач ждут зависимостей. Смотри list.`
        : 'Готовых задач нет.',
    )
    return
  }

  const task = ready[0]
  console.log(`${task.id} ${task.milestone} ${task.priority} — ${task.description.replace(/\s+/g, ' ').slice(0, 90)}`)
}

function cmdShow(id) {
  if (!id) fail('Укажи id: node tools/backlog.mjs show TASK-137')
  const { tasks } = read(ACTIVE)
  const task = findTask(tasks, id)
  const activeIds = new Set(tasks.map((t) => t.id))
  const unmet = unmetDeps(task, activeIds)

  console.log(`${task.id}  ${task.milestone}  ${task.category}  ${task.priority}  ${task.status}`)
  console.log(`\n${task.description}`)

  const section = (title, items) => {
    if (!items?.length) return
    console.log(`\n${title}:`)
    for (const item of items) console.log(`  - ${item}`)
  }
  section('Критерии приёмки', task.acceptance_criteria)
  section('Шаги проверки', task.test_steps)

  if (task.dependencies?.length) {
    console.log(`\nЗависимости: ${task.dependencies.join(', ')}`)
    console.log(unmet.length ? `  не выполнены: ${unmet.join(', ')}` : '  все выполнены')
  }
}

function cmdDecisions(needle) {
  const { reference } = read(ACTIVE)
  const entries = Object.entries(reference?.decisions ?? {})

  if (!needle) {
    for (const [key] of entries) console.log(key)
    console.log(`\nВсего ${entries.length}. Тело решения: node tools/backlog.mjs decisions <подстрока>`)
    return
  }

  const q = needle.toLowerCase()
  const hits = entries.filter(([k, v]) => k.toLowerCase().includes(q) || String(v).toLowerCase().includes(q))
  if (!hits.length) {
    console.log(`По «${needle}» ничего не нашлось.`)
    return
  }
  for (const [key, value] of hits) console.log(`${key}\n  ${value}\n`)
}

function cmdStart(id) {
  if (!id) fail('Укажи id: node tools/backlog.mjs start TASK-137')
  const data = read(ACTIVE)
  const task = findTask(data.tasks, id)

  const running = data.tasks.filter((t) => t.status === 'in_progress' && t.id !== task.id)
  if (running.length) {
    fail(`Уже в работе ${running.map((t) => t.id).join(', ')} — разберись с ней прежде, чем брать ${task.id}.`)
  }

  task.status = 'in_progress'
  write(ACTIVE, data)
  console.log(`${task.id} -> in_progress`)
}

function cmdFinish(id) {
  if (!id) fail('Укажи id: node tools/backlog.mjs finish TASK-137')
  const active = read(ACTIVE)
  const archive = read(ARCHIVE)
  const task = findTask(active.tasks, id)

  if (archive.tasks.some((t) => t.id === task.id)) fail(`${task.id} уже лежит в архиве.`)

  const dependents = active.tasks.filter((t) => t.id !== task.id && (t.dependencies ?? []).includes(task.id))

  task.status = task.status === 'obsolete' ? 'obsolete' : 'done'
  active.tasks = active.tasks.filter((t) => t.id !== task.id)
  archive.tasks.push(task)

  // Счётчики и даты считаются из данных, а не правятся руками: расхождение уже случалось.
  const today = new Date().toISOString().slice(0, 10)
  active.meta.active_tasks = active.tasks.length
  active.meta.archived_tasks = archive.tasks.length
  archive.meta.archived_tasks = archive.tasks.length
  archive.meta.updated_at = today

  write(ACTIVE, active)
  write(ARCHIVE, archive)

  console.log(`${task.id} -> ${task.status}, перенесена в архив`)
  console.log(`Активных ${active.tasks.length}, в архиве ${archive.tasks.length}`)
  if (dependents.length) {
    console.log(`Разблокированы зависевшие: ${dependents.map((t) => t.id).join(', ')}`)
  }

  // Напоминание печатает finish, а не agent_instructions в tasks.json: тот файл цикл
  // целиком не читает, и указание оттуда до агента не доходит.
  if (!active.tasks.length) {
    console.log(`\nАктивных задач не осталось — бэклог отработан, вызови /remove-backlog.`)
    return
  }

  console.log(`\nСледующая:`)
  cmdNext()
  console.log(
    `\nЗАКРЫТИЕ НЕ ЗАВЕРШЕНО: собери промпт для следующей задачи и выдай его последним\n` +
      `блоком ответа — show <id>, разведка путей сабагентом, затем копируемый блок:\n` +
      `  строка /backlog и id · одно предложение сути · пути по ролям (что править /\n` +
      `  образец рядом / где тесты / конфиг) · что выяснилось по ходу закрытой задачи ·\n` +
      `  команда проверок · чего делать НЕ надо.\n` +
      `Пути только проверенные. После блока — строка про /clear.`,
  )
}

const [command, argument] = process.argv.slice(2)

const commands = {
  list: cmdList,
  next: cmdNext,
  show: () => cmdShow(argument),
  decisions: () => cmdDecisions(argument),
  start: () => cmdStart(argument),
  finish: () => cmdFinish(argument),
}

if (!commands[command]) {
  fail(`Команды: list | next | show <id> | decisions [подстрока] | start <id> | finish <id>`)
}
commands[command]()
