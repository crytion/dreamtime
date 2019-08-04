const fs = require('fs')
const mime = require('mime-types')
const path = require('path')
const EventBus = require('js-event-bus')
const axios = require('axios')
const { api } = require('electron-utils')
const filesize = require('filesize')
const unzipper = require('unzipper')

const debug = require('debug').default('app:electron:tools:fs')

/**
 * Returns the base64 of a dataURL
 * @param {*} dataURL
 */
function getBase64Data(dataURL) {
  let encoded = dataURL.replace(/^data:(.*;base64,)?/, '')

  if (encoded.length % 4 > 0) {
    encoded += '='.repeat(4 - (encoded.length % 4))
  }

  return encoded
}

module.exports = {
  /**
   *
   * @param {string} filePath
   */
  getInfo(filePath) {
    const exists = this.exists(filePath)
    const mimetype = mime.lookup(filePath)
    const { name, ext, dir } = path.parse(filePath)

    let size

    if (exists) {
      const stats = fs.statSync(filePath)
      size = stats.size / 1000000.0
    }

    return {
      exists,
      name,
      ext,
      dir,
      mimetype,
      size
    }
  },

  /**
   *
   * @param {*} path
   */
  async read(path, encoding = 'utf-8') {
    return fs.readFileSync(path, { encoding })
  },

  /**
   *
   * @param {*} path
   * @param {*} dataURL
   */
  async writeDataURL(path, dataURL) {
    const data = getBase64Data(dataURL)
    return fs.writeFileSync(path, data, 'base64')
  },

  /**
   *
   * @param {string} filePath
   */
  exists(filePath) {
    return fs.existsSync(filePath)
  },

  /**
   * @param {string} filePath
   */
  stats(filePath) {
    return fs.statSync(filePath)
  },

  /**
   *
   * @param {string} zipPath
   * @param {string} targetPath
   */
  extract(zipPath, targetPath) {
    const bus = new EventBus()

    const stream = fs
      .createReadStream(zipPath)
      .pipe(unzipper.Extract({ path: targetPath }))

    let extracted = 0

    stream.on('close', () => {
      bus.emit('end')
    })

    stream.on('data', entryStream => {
      extracted += 1
      const progress = extracted / 4 // TODO: Hardcoded for checkpoints

      debug({
        extracted,
        entryStream
      })

      bus.emit('progress', null, progress)
    })

    stream.on('error', err => {
      bus.emit('error', null, err)
    })

    /*
    const zip = new AdmZip(zipPath)

    zip.extractAllToAsync(targetPath, overwrite, null, progress => {
      bus.emit('progress', null, progress)

      if (progress === 1) {
        bus.emit('end', null, progress)
      }
    })
    */

    return bus
  },

  /**
   *
   */
  download(url, options = {}) {
    const bus = new EventBus()

    options = {
      showSaveAs: false,
      directory: api.app.getPath('downloads'),
      ...options
    }

    axios
      .request({
        url,
        timeout: 3000,
        responseType: 'stream',
        maxContentLength: -1
      })
      .then(response => {
        console.log(response)

        const fileName = path.basename(url)
        const filePath = path.join(options.directory, fileName)

        const deleteFile = () => {
          if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath)
          }
        }

        deleteFile()

        const output = fs.createWriteStream(filePath)

        const contentLength = response.data.headers['content-length'] || -1
        const mbTotal = filesize(contentLength, {
          exponent: 2,
          output: 'object'
        }).value

        const stream = response.data

        stream.socket.setTimeout(3000)

        stream.on('data', chunk => {
          output.write(Buffer.from(chunk))

          if (contentLength > 0) {
            const progress = output.bytesWritten / contentLength
            const mbWritten = filesize(output.bytesWritten, {
              exponent: 2,
              output: 'object'
            }).value

            bus.emit('progress', null, {
              progress,
              mbWritten,
              mbTotal
            })
          } else {
            const mbWritten = filesize(output.bytesWritten, {
              exponent: 2,
              output: 'object'
            }).value

            bus.emit('progress', null, {
              progress: -1,
              mbWritten,
              mbTotal
            })
          }
        })

        stream.on('end', () => {
          output.end()
          bus.emit('end', null, filePath)
        })

        stream.on('error', err => {
          deleteFile()
          bus.emit('error', null, err)
        })

        stream.socket.on('error', err => {
          deleteFile()
          bus.emit('error', null, err)
        })

        stream.socket.on('timeout', () => {
          deleteFile()
          bus.emit('error', null, new Error('Timeout'))
        })

        bus.on('cancel', () => {
          debug('Download canceled!')
          stream.destroy(new Error('Canceled'))
          deleteFile()
        })
      })
      .catch(err => {
        bus.emit('error', null, err)
      })

    /*
      .catch(err => {
        console.warn(``, err)
        rollbar.warn(err)
        bus.emit('error', null, err)
      })
      */

    return bus
  }
}