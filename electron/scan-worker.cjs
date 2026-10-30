const { parentPort, workerData } = require('worker_threads')
const { buildScan, cleanPaths } = require('./scan.cjs')
const { buildPhotoScan } = require('./photos.cjs')

function report(message) {
  parentPort.postMessage(message)
}

try {
  if (workerData?.type === 'scan') {
    const result = buildScan((progress) => {
      report({ type: 'progress', progress })
    })
    report({ type: 'result', result })
  } else if (workerData?.type === 'clean') {
    const result = cleanPaths(workerData.paths || [], (progress) => {
      report({ type: 'progress', progress })
    })
    report({ type: 'result', result })
  } else if (workerData?.type === 'photos-scan') {
    const result = buildPhotoScan(
      (progress) => {
        report({ type: 'progress', progress })
      },
      { ignoredKeys: workerData.ignoredKeys || [] },
    )
    report({ type: 'result', result })
  } else {
    throw new Error(`未知任务类型: ${workerData?.type}`)
  }
} catch (error) {
  report({
    type: 'error',
    error: {
      message: error.message || String(error),
      stack: error.stack,
    },
  })
}
