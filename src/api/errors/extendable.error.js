class ExtendableError extends Error {
    constructor({ message, errors, status, isPublic = false }) {
        super(message)
        this.name = this.constructor.name
        this.message = message
        this.errors = errors
        this.status = status
        this.isPublic = isPublic
    }
}

module.exports = ExtendableError
