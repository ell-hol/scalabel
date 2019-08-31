import { withStyles } from '@material-ui/core/styles'
import * as React from 'react'
import EventListener, { withOptions } from 'react-event-listener'
import Session from '../common/session'
import { Label2DList } from '../drawable/label2d_list'
import { decodeControlIndex, rgbToIndex } from '../drawable/util'
import { isItemLoaded } from '../functional/state_util'
import { State, ViewerConfigType } from '../functional/types'
import { Size2D } from '../math/size2d'
import { Vector2D } from '../math/vector2d'
import { imageViewStyle } from '../styles/label'
import { Canvas2d } from './canvas2d'
import { getCurrentItem, getCurrentViewerConfig } from './image_view'

interface ClassType {
  /** label canvas */
  label_canvas: string
  /** control canvas */
  control_canvas: string
  /** image display area */
  display: string
  /** background */
  transparent_background: string
}

interface Props {
  /** styles */
  classes: ClassType
}

/**
 * Function to find mode of a number array.
 * @param {number[]} arr - the array.
 * @return {number} the mode of the array.
 */
export function mode (arr: number[]) {
  return arr.sort((a, b) =>
    arr.filter((v) => v === a).length
    - arr.filter((v) => v === b).length
  ).pop()
}

/**
 * Canvas Viewer
 */
export class Label2DView extends Canvas2d<Props> {
  /** The label context */
  public labelContext: CanvasRenderingContext2D | null
  /** The control context */
  public controlContext: CanvasRenderingContext2D | null

  /** drawable label list */
  private _labels: Label2DList
  /** The label canvas */
  private labelCanvas: HTMLCanvasElement | null
  /** The control canvas */
  private controlCanvas: HTMLCanvasElement | null
  /** The mask to hold the display */
  private display: HTMLDivElement | null
  /** The mask to hold the background */
  private background: HTMLDivElement | null

  // display constants
  /** The maximum scale */
  private readonly MAX_SCALE: number
  /** The minimum scale */
  private readonly MIN_SCALE: number
  /** The boosted ratio to draw shapes sharper */
  private readonly UP_RES_RATIO: number

  // display variables
  /** The current scale */
  private scale: number
  /** The canvas height */
  private canvasHeight: number
  /** The canvas width */
  private canvasWidth: number
  /** The scale between the display and image data */
  private displayToImageRatio: number

  // keyboard and mouse status
  /** The hashed list of keys currently down */
  private _keyDownMap: { [key: string]: boolean }

  // grabbing
  /** Whether or not the mouse is currently grabbing the image */
  private _isGrabbingImage: boolean
  /** The x coordinate when the grab starts */
  private _startGrabX: number
  /** The y coordinate when the grab starts */
  private _startGrabY: number
  /** The visible coordinates when the grab starts */
  private _startGrabVisibleCoords: number[]

  /**
   * Constructor, handles subscription to store
   * @param {Object} props: react props
   */
  constructor (props: Readonly<Props>) {
    super(props)

    // constants
    this.MAX_SCALE = 3.0
    this.MIN_SCALE = 1.0
    this.UP_RES_RATIO = 2

    // initialization
    this._keyDownMap = {}
    this._isGrabbingImage = false
    this._startGrabX = -1
    this._startGrabY = -1
    this._startGrabVisibleCoords = []
    this.scale = 1
    this.canvasHeight = 0
    this.canvasWidth = 0
    this.displayToImageRatio = 1
    this.controlContext = null
    this.controlCanvas = null
    this.labelContext = null
    this.labelCanvas = null
    this.display = null
    this.background = null

    this._labels = new Label2DList()
  }

  /**
   * Set up for when component is successfully mounted
   */
  public componentDidMount () {
    // set keyboard listeners
    document.addEventListener('keydown', this.onKeyDown.bind(this))
    document.addEventListener('keyup', this.onKeyUp.bind(this))
  }

  /**
   * Set the current cursor
   * @param {string} cursor - cursor type
   */
  public setCursor (cursor: string) {
    if (this.labelCanvas !== null) {
      this.labelCanvas.style.cursor = cursor
    }
  }

  /**
   * Set the current cursor to default
   */
  public setDefaultCursor () {
    this.setCursor('crosshair')
  }

  /**
   * Get the current item in the state
   * @return {Size2D}
   */
  public getCurrentImageSize (): Size2D {
    const item = getCurrentItem()
    const image = Session.images[item.index]
    return new Size2D(image.width, image.height)
  }

  /**
   * Convert image coordinate to canvas coordinate.
   * If affine, assumes values to be [x, y]. Otherwise
   * performs linear transformation.
   * @param {Vector2D} values - the values to convert.
   * @param {boolean} upRes
   * @return {Vector2D} - the converted values.
   */
  public toCanvasCoords (values: Vector2D, upRes: boolean): Vector2D {
    const out = values.clone().scale(this.displayToImageRatio)
    if (upRes) {
      out.scale(this.UP_RES_RATIO)
    }
    return out
  }

  /**
   * Convert canvas coordinate to image coordinate.
   * If affine, assumes values to be [x, y]. Otherwise
   * performs linear transformation.
   * @param {Vector2D} values - the values to convert.
   * @param {boolean} upRes - whether the canvas has higher resolution
   * @return {Vector2D} - the converted values.
   */
  public toImageCoords (values: Vector2D, upRes: boolean = true): Vector2D {
    const up = (upRes) ? 1 / this.UP_RES_RATIO : 1
    return values.clone().scale(this.displayToImageRatio * up)
  }

  /**
   * Render function
   * @return {React.Fragment} React fragment
   */
  public render () {
    const { classes } = this.props
    const controlCanvas = (<canvas
      key='control-canvas'
      className={classes.control_canvas}
      ref={(canvas) => {
        if (canvas && this.display) {
          this.controlCanvas = canvas
          this.controlContext = canvas.getContext('2d')
          const displayRect =
            this.display.getBoundingClientRect()
          if (displayRect.width
            && displayRect.height
            && this.currentItemIsLoaded()) {
            this.updateScale(canvas, true)
          }
        }
      }}
    />)
    const labelCanvas = (<canvas
      key='label-canvas'
      className={classes.label_canvas}
      ref={(canvas) => {
        if (canvas && this.display) {
          this.labelCanvas = canvas
          this.labelContext = canvas.getContext('2d')
          const displayRect =
            this.display.getBoundingClientRect()
          if (displayRect.width
            && displayRect.height
            && this.currentItemIsLoaded()) {
            this.updateScale(canvas, true)
          }
        }
      }}
    />)

    let canvasesWithProps
    if (this.display) {
      const displayRect = this.display.getBoundingClientRect()
      canvasesWithProps = React.Children.map(
        [controlCanvas, labelCanvas], (canvas) => {
          return React.cloneElement(canvas,
            { height: displayRect.height, width: displayRect.width })
        }
      )
    }

    return (
      <div ref={(element) => {
        if (element) {
          this.background = element
        }
      }} className={classes.transparent_background}>
        <EventListener
          target='parent'
          onMouseDown={(e) => this.onMouseDown(e)}
          onMouseMove={(e) => this.onMouseMove(e)}
          onMouseUp={(e) => this.onMouseUp(e)}
          onMouseLeave={(e) => this.onMouseLeave(e)}
          onDblClick={(e) => this.onDblClick(e)}
          onWheel={withOptions((e) => this.onWheel(e), { passive: false })}
        />
        <div ref={(element) => {
          if (element) {
            this.display = element
          }
        }}
          className={classes.display}
        >
          {canvasesWithProps}
        </div>
      </div>
    )
  }

  /**
   * Function to redraw all canvases
   * @return {boolean}
   */
  public redraw (): boolean {
    if (this.labelCanvas !== null && this.labelContext !== null &&
      this.controlCanvas !== null && this.controlContext !== null) {
      this.clearCanvas(this.labelCanvas, this.labelContext)
      this.clearCanvas(this.controlCanvas, this.controlContext)
      this._labels.redraw(this.labelContext, this.controlContext,
        this.displayToImageRatio * this.UP_RES_RATIO)
    }
    return true
  }

  /**
   * notify state is updated
   */
  protected updateState (state: State): void {
    this._labels.updateState(state, state.user.select.item)
  }

  /**
   * Clear the canvas
   * @param {HTMLCanvasElement} canvas - the canvas to redraw
   * @param {any} context - the context to redraw
   * @return {boolean}
   */
  protected clearCanvas (canvas: HTMLCanvasElement,
                         context: CanvasRenderingContext2D): boolean {
    // clear context
    context.clearRect(0, 0, canvas.width, canvas.height)
    return true
  }

  /**
   * Get the coordinates of the upper left corner of the image canvas
   * @return {Vector2D} the x and y coordinates
   */
  private getVisibleCanvasCoords (): Vector2D {
    if (this.display && this.controlCanvas) {
      const displayRect = this.display.getBoundingClientRect() as DOMRect
      const imgRect = this.controlCanvas.getBoundingClientRect() as DOMRect
      return new Vector2D(displayRect.x - imgRect.x, displayRect.y - imgRect.y)
    }
    return new Vector2D(0, 0)
  }

  /**
   * Get the mouse position on the canvas in the image coordinates.
   * @param {MouseEvent | WheelEvent} e: mouse event
   * @return {Vector2D}
   * mouse position (x,y) on the canvas
   */
  private getMousePos (e: MouseEvent | WheelEvent): Vector2D {
    if (this.display) {
      const [offsetX, offsetY] = this.getVisibleCanvasCoords()
      const displayRect = this.display.getBoundingClientRect() as DOMRect
      let x = e.clientX - displayRect.x + offsetX
      let y = e.clientY - displayRect.y + offsetY

      // limit the mouse within the image
      x = Math.max(0, Math.min(x, this.canvasWidth))
      y = Math.max(0, Math.min(y, this.canvasHeight))

      // return in the image coordinates
      return new Vector2D(x / this.displayToImageRatio,
        y / this.displayToImageRatio)
    }
    return new Vector2D(0, 0)
  }

  /**
   * Get the label under the mouse.
   * @param {Vector2D} mousePos: position of the mouse
   * @return {number[]}
   */
  private fetchHandleId (mousePos: Vector2D): number[] {
    if (this.controlContext) {
      const [x, y] = this.toCanvasCoords(mousePos,
        true)
      const data = this.controlContext.getImageData(x, y, 4, 4).data
      const arr = []
      for (let i = 0; i < 16; i++) {
        const color = rgbToIndex(Array.from(data.slice(i * 4, i * 4 + 3)))
        arr.push(color)
      }
      // finding the mode of the data array to deal with anti-aliasing
      const hoveredIndex = mode(arr) as number
      return decodeControlIndex(hoveredIndex)
    } else {
      return [-1, 0]
    }
  }

  /**
   * Whether or not the mouse event is within the frame
   */
  private isWithinFrame (e: MouseEvent) {
    if (this.background === null) {
      return false
    }
    const background = this.background.getBoundingClientRect()
    return e.x >= background.left && e.y >= background.top &&
           e.x <= background.left + background.width &&
           e.y <= background.top + background.height
  }

  /**
   * Callback function when mouse is down
   * @param {MouseEvent} e - event
   */
  private onMouseDown (e: MouseEvent) {
    if (!this.isWithinFrame(e) || e.button !== 0) {
      return
    }
    // ctrl + click for dragging
    if (this.isKeyDown('Control')) {
      if (this.display && this.controlCanvas) {
        const display = this.display.getBoundingClientRect()
        if (this.controlCanvas.width > display.width ||
          this.controlCanvas.height > display.height) {
          // if needed, start grabbing
          this.setCursor('grabbing')
          this._isGrabbingImage = true
          this._startGrabX = e.clientX
          this._startGrabY = e.clientY
          this._startGrabVisibleCoords = this.getVisibleCanvasCoords()
        }
      }
    } else {
      // get mouse position in image coordinates
      const mousePos = this.getMousePos(e)
      const [labelIndex, handleIndex] = this.fetchHandleId(mousePos)
      this._labels.onMouseDown(mousePos, labelIndex, handleIndex)
    }
    this.redraw()
  }

  /**
   * Callback function when mouse is up
   * @param {MouseEvent} e - event
   */
  private onMouseUp (e: MouseEvent) {
    if (!this.isWithinFrame(e) || e.button !== 0) {
      return
    }
    // get mouse position in image coordinates
    this._isGrabbingImage = false
    this._startGrabX = -1
    this._startGrabY = -1
    this._startGrabVisibleCoords = []

    const mousePos = this.getMousePos(e)
    const [labelIndex, handleIndex] = this.fetchHandleId(mousePos)
    this._labels.onMouseUp(mousePos, labelIndex, handleIndex)
    this.redraw()
  }

  /**
   * Callback function when mouse leaves
   * @param {MouseEvent} e - event
   */
  private onMouseLeave (e: MouseEvent) {
    this._keyDownMap = {}
    this.onMouseUp(e)
  }

  /**
   * Callback function when mouse moves
   * @param {MouseEvent} e - event
   */
  private onMouseMove (e: MouseEvent) {
    if (!this.isWithinFrame(e)) {
      this.onMouseLeave(e)
      return
    }
    // TODO: update hovered label
    // grabbing image
    if (this.isKeyDown('Control')) {
      if (this._isGrabbingImage) {
        if (this.display) {
          this.setCursor('grabbing')
          const dx = e.clientX - this._startGrabX
          const dy = e.clientY - this._startGrabY
          this.display.scrollLeft = this._startGrabVisibleCoords[0] - dx
          this.display.scrollTop = this._startGrabVisibleCoords[1] - dy
        }
      } else {
        this.setCursor('grab')
      }
    } else {
      this.setDefaultCursor()
    }

    // update the currently hovered shape
    const mousePos = this.getMousePos(e)
    const [labelIndex, handleIndex] = this.fetchHandleId(mousePos)
    this._labels.onMouseMove(
      mousePos, this.getCurrentImageSize(), labelIndex, handleIndex)
    this.redraw()
  }

  /**
   * Callback function for scrolling
   * @param {WheelEvent} e - event
   */
  private onWheel (e: WheelEvent) {
    if (!this.isWithinFrame(e)) {
      return
    }
    if (this.isKeyDown('Control')) { // control for zoom
      this.redraw()
    }
  }

  /**
   * Callback function when double click occurs
   * @param {MouseEvent} e - event
   */
  private onDblClick (e: MouseEvent) {
    // get mouse position in image coordinates
    // const mousePos = this.getMousePos(e)
    // label-specific handling of double click
    // this.getCurrentController().onDblClick(mousePos)
    if (!this.isWithinFrame(e)) {
      return
    }
  }

  /**
   * Callback function when key is down
   * @param {KeyboardEvent} e - event
   */
  private onKeyDown (e: KeyboardEvent) {
    const key = e.key
    this._keyDownMap[key] = true
  }

  /**
   * Callback function when key is up
   * @param {KeyboardEvent} e - event
   */
  private onKeyUp (e: KeyboardEvent) {
    const key = e.key
    delete this._keyDownMap[key]
  }

  /**
   * Whether a specific key is pressed down
   * @param {string} key - the key to check
   * @return {boolean}
   */
  private isKeyDown (key: string): boolean {
    return this._keyDownMap[key]
  }

  /**
   * Get the padding for the image given its size and canvas size.
   * @return {Vector2D} padding
   */
  private _getPadding (): Vector2D {
    if (this.display) {
      const displayRect = this.display.getBoundingClientRect()
      return new Vector2D(
        Math.max(0, (displayRect.width - this.canvasWidth) / 2),
        Math.max(0, (displayRect.height - this.canvasHeight) / 2))
    }
    return new Vector2D(0, 0)
  }

  /**
   * Set the scale of the image in the display
   * @param {object} canvas
   * @param {boolean} upRes
   */
  private updateScale (canvas: HTMLCanvasElement, upRes: boolean) {
    if (!this.display || !this.controlCanvas || !this.controlContext) {
      return
    }
    const displayRect = this.display.getBoundingClientRect()
    const config: ViewerConfigType = getCurrentViewerConfig()
    // mouseOffset
    let mouseOffset
    let upperLeftCoords
    if (config.viewScale > 1.0) {
      upperLeftCoords = this.getVisibleCanvasCoords()
      if (config.viewOffsetX < 0 || config.viewOffsetY < 0) {
        mouseOffset = [
          Math.min(displayRect.width, this.controlCanvas.width) / 2,
          Math.min(displayRect.height, this.controlCanvas.height) / 2
        ]
      } else {
        mouseOffset = this.toCanvasCoords(
          new Vector2D(config.viewOffsetX, config.viewOffsetY), false)
        mouseOffset[0] -= upperLeftCoords[0]
        mouseOffset[1] -= upperLeftCoords[1]
      }
    }

    // set scale
    let zoomRatio
    if (config.viewScale >= this.MIN_SCALE
      && config.viewScale < this.MAX_SCALE) {
      zoomRatio = config.viewScale / this.scale
      this.controlContext.scale(zoomRatio, zoomRatio)
    } else {
      return
    }

    // resize canvas
    const item = getCurrentItem()
    const image = Session.images[item.index]
    const ratio = image.width / image.height
    if (displayRect.width / displayRect.height > ratio) {
      this.canvasHeight = displayRect.height * config.viewScale
      this.canvasWidth = this.canvasHeight * ratio
      this.displayToImageRatio = this.canvasHeight
        / image.height
    } else {
      this.canvasWidth = displayRect.width * config.viewScale
      this.canvasHeight = this.canvasWidth / ratio
      this.displayToImageRatio = this.canvasWidth / image.width
    }

    // translate back to origin
    if (mouseOffset) {
      this.display.scrollTop = this.controlCanvas.offsetTop
      this.display.scrollLeft = this.controlCanvas.offsetLeft
    }

    // set canvas resolution
    if (upRes) {
      canvas.height = this.canvasHeight * this.UP_RES_RATIO
      canvas.width = this.canvasWidth * this.UP_RES_RATIO
    } else {
      canvas.height = this.canvasHeight
      canvas.width = this.canvasWidth
    }

    // set canvas size
    canvas.style.height = this.canvasHeight + 'px'
    canvas.style.width = this.canvasWidth + 'px'

    // set padding
    const padding = this._getPadding()
    const padX = padding.x
    const padY = padding.y

    canvas.style.left = padX + 'px'
    canvas.style.top = padY + 'px'
    canvas.style.right = 'auto'
    canvas.style.bottom = 'auto'

    // zoom to point
    if (mouseOffset && upperLeftCoords) {
      if (this.canvasWidth > displayRect.width) {
        this.display.scrollLeft =
          zoomRatio * (upperLeftCoords[0] + mouseOffset[0])
          - mouseOffset[0]
      }
      if (this.canvasHeight > displayRect.height) {
        this.display.scrollTop =
          zoomRatio * (upperLeftCoords[1] + mouseOffset[1])
          - mouseOffset[1]
      }
    }

    this.scale = config.viewScale
  }

  /**
   * function to check if the current item is loaded
   * @return {boolean}
   */
  private currentItemIsLoaded (): boolean {
    return isItemLoaded(this.state.session)
  }
}

export default withStyles(imageViewStyle, { withTheme: true })(Label2DView)