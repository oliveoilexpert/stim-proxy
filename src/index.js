function kebabCase(str) {
    return str.replace(/[A-Z]+(?![a-z])|[A-Z]/g, ($, ofs) => (ofs ? "-" : "") + $.toLowerCase())
}

function camelCase(str) {
    return str.replace(/-([a-z])/g,  (g) => {
        return g[1].toUpperCase();
    });
}

class PropertyAttributeSyncer {
    attributes = {}
    attrKeyMap = {}
    convertKey = attrKey => {
        return kebabCase(attrKey)
    }
    constructor(constructorObject, attributes = {}) {
        this.attributes = attributes
        Object.keys(this.attributes).forEach(attrKey => {
            const dataAttr = this.convertKey(attrKey)
            this.attrKeyMap[attrKey] = dataAttr
            this.attrKeyMap[dataAttr] = attrKey
        })
    }

    write(attrKey, val) {
        if (typeof this.attributes[attrKey] == 'string') {
            return val
        }
        if (typeof this.attributes[attrKey] == 'boolean') {
            return val ? '' : 'false'
        }
        try { return JSON.stringify(val) } catch { return val }
    }
    read(attrKey, val) {
        if (typeof this.attributes[attrKey] == 'string') {
            return val
        }
        if (typeof this.attributes[attrKey] == 'boolean') {
            return val !== '0' && val !== 'false'
        }
        try { return JSON.parse(val) } catch { return val }
    }

    initializeAttributes(object, element, argAttributes = {}) {
        const attrAttributes = JSON.parse(element.getAttribute('data-props') || '{}')
        for (const attrKey in this.attributes) {
            const attr = this.attrKeyMap[attrKey]
            if (element.hasAttribute(attr)) {
                this.setAttribute(object, element, attrKey, this.read(attrKey, element.getAttribute(attr)), false)
            } else if (Object.prototype.hasOwnProperty.call(attrAttributes, attrKey)) {
                this.setAttribute(object, element, attrKey, attrAttributes[attrKey], true)
            } else if (Object.prototype.hasOwnProperty.call(argAttributes, attrKey)) {
                this.setAttribute(object, element, attrKey, argAttributes[attrKey], true)
            } else {
                this.setAttribute(object, element, attrKey, this.attributes[attrKey], false)
            }
        }
        element.removeAttribute('data-props')
    }

    setAttribute(object, element, attrKey, val, sync = true) {
        if (val === object[`#${attrKey}`]) return
        const oldVal = object[`#${attrKey}`]
        object[`#${attrKey}`] = val
        if (typeof object[`${attrKey}Changed`] === 'function') {
            object[`${attrKey}Changed`](oldVal, val)
        }
        if (!sync) return
        const writeVal = this.write(attrKey, val)
        const writeName = this.attrKeyMap[attrKey]
        if (
           typeof this.attributes[attrKey] === 'object'
           && writeVal === this.write(attrKey, this.attributes[attrKey])
        ) {
            element.removeAttribute(writeName)
            return
        }
        if (val === this.attributes[attrKey]) {
            element.removeAttribute(writeName)
            return
        }
        element.setAttribute(writeName, writeVal)
    }

    attributeChanged(object, element, name, oldVal, newVal) {
        if (name === 'data-props') {
            this.initializeAttributes(object, element)
            return
        }
        const attrKey = this.attrKeyMap[name]
        // if (!attrKey) {
        // 	aspect.attributeChanged(name, oldVal, newVal)
        // 	return
        // }
        let newReadVal
        if (newVal === null || newVal === undefined) {
            newReadVal = this.attributes[attrKey]
        } else {
            newReadVal = this.read(attrKey, newVal)
        }
        this.setAttribute(object, element, attrKey, newReadVal, false)
    }
}

const orphanMap = new Map()

class ProxyTarget extends HTMLElement {
    static observedAttributes = ['as', 'for', 'host']
    get as() {
        return this.getAttribute('as')
    }
    get for() {
        return this.getAttribute('for')
    }
    get hostId() {
        return this.getAttribute('host')
    }
    get target() {
        return this.parentElement
    }
    get camelCasedType() {
        return camelCase(this.as)
    }
    host = null
    proxy = null
    connectedCallback() {
        window.requestAnimationFrame(() => {
            this.host = this.hostId ? document.getElementById(this.hostId) : this.closest('[data-scope]')
            this.proxy = this.host?.querySelector(`:scope > ${this.for}-proxy`)
            if (!this.proxy || this.proxy.target !== this.host) {
                if (this.hostId) {
                    if (!orphanMap.has(this.hostId)) {
                        orphanMap.set(this.hostId, new Set())
                    }
                    orphanMap.get(this.hostId).add(this)
                    return
                }
                if (!orphanMap.has('')) {
                    orphanMap.set('', new Set())
                }
                orphanMap.get('').add(this)
                return
            }
            if (this.proxy[`${this.camelCasedType}ConnectedCallback`]) {
                this.proxy[`${this.camelCasedType}ConnectedCallback`](this.target)
            }
            this.proxy[`${this.camelCasedType}Targets`].add(this.target)
        })
    }
    disconnectedCallback() {
        window.requestAnimationFrame(() => {
            if (!this.proxy) {
                return
            }
            if (this.proxy[`${this.camelCasedType}DisconnectedCallback`]) {
                this.proxy[`${this.camelCasedType}DisconnectedCallback`](this.target)
            }
            this.proxy[`${this.camelCasedType}Targets`].delete(this.target)
        })
    }
    attributeChangedCallback(name, oldVal, newVal) {
        if (['as', 'for', 'host-id'].includes(name)) {
            this.disconnectedCallback()
            this.connectedCallback()
        }
    }
}

class ProxyElement extends HTMLElement {
    static attributes = {}
    static targets = []
    static injections = []
    static observedAttributes = []
    static token = ''
    get target() {
        return this.parentElement
    }
    get token() {
        return this.constructor.token
    }
    constructor() {
        super()
        this.constructor.__propertyAttributeSyncer.initializeAttributes(this, this)
        this.initializedCallback()
    }
    initializedCallback() {}
    attributeChangedCallback(name, oldVal, newVal) {
        this.constructor.__propertyAttributeSyncer.attributeChanged(this, this, name, oldVal, newVal)
    }
    connectedCallback() {
        const scope = this.target.getAttribute('data-scope') || ''
        this.target.setAttribute('data-scope', `${scope} ${this.token} `)
        if (orphanMap.has(this.target.id)) {
            const orphans = orphanMap.get(this.target.id)
            orphanMap.delete(this.target.id)
            for (const orphan of orphans) {
                orphan.connectedCallback()
            }
        }
        for (const orphan of orphanMap.get('') ?? []) {
            if (this.target.contains(orphan)) {
                orphanMap.get('').delete(orphan)
                orphan.connectedCallback()
            }
        }
    }
    disconnectedCallback() {
        const scope = this.target.getAttribute('data-scope') || ''
        this.target.setAttribute('data-scope', scope.replace(` ${this.token} `, ''))
    }
    dispatch(type, {
        target = this.target,
        prefix = this.token,
        detail = {},
        bubbles = false,
        cancelable = false,
        composed = false
    } = {}) {
        const fullType = prefix ? `${prefix}:${type}` : type
        const event = new CustomEvent(fullType, { detail, bubbles, cancelable, composed })
        target.dispatchEvent(event)
        return event
    }
}

const processProxyElement = (constructorObject, token) => {
    constructorObject.token = token
    constructorObject.__propertyAttributeSyncer = new PropertyAttributeSyncer(constructorObject, constructorObject.attributes)
    for (const propKey of Object.keys(constructorObject.attributes)) {
        constructorObject.observedAttributes.push(constructorObject.__propertyAttributeSyncer.attrKeyMap[propKey])
        Object.defineProperty(constructorObject.prototype, propKey, {
            get() {
                return this[`#${propKey}`]
            },
            set(val) {
                constructorObject.__propertyAttributeSyncer.setAttribute(this, this, propKey, val, true)
            }
        })
    }
    for (const targetToken of constructorObject.targets) {
        const camelCasedType = camelCase(targetToken)
        constructorObject.prototype[`${camelCasedType}Targets`] = new Set()
        Object.defineProperty(constructorObject.prototype, `${camelCasedType}Target`, {
            get() {
                return this[`${camelCasedType}Targets`].values()?.next()?.value
            },
        })
    }
}
const registerProxyElement = (token, constructorObject) => {
    processProxyElement(constructorObject, token)
    customElements.define(`${token}-proxy`, constructorObject)
}

customElements.define('proxy-target', ProxyTarget)

export { ProxyElement, registerProxyElement }