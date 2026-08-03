//F# の詳細 (http://fsharp.net)
open System
open System.Drawing
open System.Windows
open Kimuraya

/// WPFコンポーネントテスト
let createWPFForm comp = 
    let form = new System.Windows.Forms.Form ()
    let ctrlHost = new System.Windows.Forms.Integration.ElementHost ()
    ctrlHost.Dock <- System.Windows.Forms.DockStyle.Fill
    ctrlHost.Child <- comp
    form.Controls.Add( ctrlHost )
    form.Show()
    form

type WPFForm () =
    inherit System.Windows.Forms.Form() 
    let ctrlHost = new System.Windows.Forms.Integration.ElementHost ()
    do ctrlHost.Dock <- System.Windows.Forms.DockStyle.Fill
    do base.Controls.Add( ctrlHost )
    do base.Show()
    member x.setcomp( comp ) = ctrlHost.Child <- comp
    interface System.IDisposable with
        member x.Dispose () =
            base.Dispose ()

let approx_line (points : (float*float) list)=
    let xx = points |> List.map (fun (x,_) -> x*x) |> List.sum 
    let xy = points |> List.map (fun (x,y) -> x*y) |> List.sum
    let yy = points |> List.map (fun (_,y) -> y*y) |> List.sum
    let x = points |> List.map (fun (x,_) -> x) |> List.sum 
    let y = points |> List.map (fun (_,y) -> y) |> List.sum 
    let n = float <| List.length points
    let ad_bc = xx*n-x*x
    let a = (xy*n-x*y)/ad_bc
    let b = (-xy*x+xx*y)/ad_bc
    let error = (points |> List.map (fun (x,y) ->
        (a*x-y+b)*(a*x-y+b)/(a*a+1.0)
        ) |> List.sum) / n
    (a,b,error)

let detA2 (a : float) b c d = 
    a*d-b*c

let detA3 (a : float array) (b : float array) (c : float array) =
    a.[0]*detA2 b.[1] c.[1] b.[2] c.[2]
    - b.[0]*detA2 a.[1] c.[1] a.[2] c.[2]
    + c.[0]*detA2 a.[1] b.[1] a.[2] b.[2]

let invA3 (a : float array array) =
    let detA = detA3 a.[0] a.[1] a.[2]
    [|[|a.[1].[1]*a.[2].[2]-a.[1].[2]*a.[2].[1]; a.[0].[2]*a.[2].[1]-a.[0].[1]*a.[2].[2]; a.[0].[1]*a.[1].[2]-a.[0].[2]*a.[1].[1]|];
      [|a.[1].[2]*a.[2].[0]-a.[1].[0]*a.[2].[2]; a.[0].[0]*a.[2].[2]-a.[0].[2]*a.[2].[0]; a.[0].[2]*a.[1].[0]-a.[0].[0]*a.[1].[2]|];
      [|a.[1].[0]*a.[2].[1]-a.[1].[1]*a.[2].[0]; a.[0].[1]*a.[2].[0]-a.[0].[0]*a.[2].[1]; a.[0].[0]*a.[1].[1]-a.[0].[1]*a.[1].[0]|]|]
    |> Array.map (Array.map (fun x -> x/detA))

let approx_circle (points : (float*float) list)=
    let x3_xy2 = points |> List.map (fun (x,y) -> x*x*x+x*y*y) |> List.sum 
    let x2y_y3 = points |> List.map (fun (x,y) -> x*x*y+y*y*y) |> List.sum 
    let x2_y2 = points |> List.map (fun (x,y) -> x*x+y*y) |> List.sum 
    let xx = points |> List.map (fun (x,_) -> x*x) |> List.sum 
    let xy = points |> List.map (fun (x,y) -> x*y) |> List.sum
    let yy = points |> List.map (fun (_,y) -> y*y) |> List.sum
    let x = points |> List.map (fun (x,_) -> x) |> List.sum 
    let y = points |> List.map (fun (_,y) -> y) |> List.sum 
    let n = float <| List.length points
    let A = [|[|xx;xy;x|];[|xy;yy;y|];[|x;y;n|]|]
    let invA = invA3 A
    let A = -x3_xy2*invA.[0].[0] - x2y_y3*invA.[0].[1] - x2_y2*invA.[0].[2]
    let B = -x3_xy2*invA.[1].[0] - x2y_y3*invA.[1].[1] - x2_y2*invA.[1].[2]
    let C = -x3_xy2*invA.[2].[0] - x2y_y3*invA.[2].[1] - x2_y2*invA.[2].[2]
    let a = -A/2.0
    let b = -B/2.0
    let r = sqrt(a*a+b*b-C)
    let error = (points |> List.map (fun (x,y) ->
        let dr = sqrt((x-a)*(x-a)+(y-b)*(y-b)) - r
        dr*dr) |> List.sum) / n
    (-A/2.0,-b/2.0,r,error)

[<STAThread>]
do
    let state = ref ([],new Shapes.Polyline())
    let canvas = new Controls.Canvas()
    do canvas.Cursor <- Input.Cursors.Cross
    canvas.Background <- Media.Brushes.White
    canvas.MouseMove.Add( fun (e : Input.MouseEventArgs) ->
        let position = e.GetPosition( canvas )
        if e.LeftButton = Input.MouseButtonState.Pressed then
            let (points,polyline) = !state
            polyline.Points.Add( position )
            state := ((position.X,position.Y)::points,polyline)
        )
    canvas.MouseDown.Add( fun (e : Input.MouseButtonEventArgs) ->
        let polyline = new Shapes.Polyline ()
        polyline.Stroke <- Media.Brushes.Black
        polyline.StrokeThickness <- 1.0
        polyline.FillRule <- Media.FillRule.EvenOdd
        canvas.Children.Add( polyline ) |> ignore
        state := ([],polyline)
        )
    canvas.MouseUp.Add( fun (e : Input.MouseButtonEventArgs) ->
        let (points,polyline) = !state
//        do
//            let (a,b,error) = approx_line points
//            let score = error
//            let width = canvas.ActualWidth
//            let line = new Shapes.Polyline ()
//            line.Stroke <- Media.Brushes.Red
//            line.StrokeThickness <- 1.0
//            line.FillRule <- Media.FillRule.EvenOdd
//            line.Points.Add( Point( 0.0, b ) ) |> ignore
//            line.Points.Add( Point( width, a*width + b ) ) |> ignore
//            canvas.Children.Add( line ) |> ignore
//            let text = new Controls.TextBlock()
//            text.Text <- sprintf "%d" (int score)
//            text.FontSize <- 40.0
//            let anim = new Media.Animation.DoubleAnimation();
//            anim.From <- new Nullable<float>( 1.0 )
//            anim.To <- new Nullable<float>( 0.0 )
//            anim.Duration <- new System.Windows.Duration( System.TimeSpan.FromSeconds( 10.0 ) )
//            text.BeginAnimation( 
//                    Controls.TextBlock.OpacityProperty,
//                    anim )
//            line.BeginAnimation( 
//                    Shapes.Polyline.OpacityProperty,
//                    anim )
//            polyline.BeginAnimation( 
//                    Shapes.Polyline.OpacityProperty,
//                    anim )
//            Kimuraya.Concurrency.delay_func
//                11000
//                (fun () -> 
//                    canvas.Children.Remove( text )
//                    canvas.Children.Remove( line )
//                    canvas.Children.Remove( polyline))
//            canvas.Children.Add( text ) |> ignore
        do
            let (a,b,r,error) = approx_circle points
            let score = r*r/error
            let circle = new Shapes.Ellipse()
            circle.Stroke <- Media.Brushes.Red
            circle.StrokeThickness <- 1.0
            circle.Width  <- r*2.0
            circle.Height <- r*2.0
            Controls.Canvas.SetLeft( circle, a-r )
            Controls.Canvas.SetTop( circle, -b*2.0-r )
            canvas.Children.Add( circle ) |> ignore
            let text = new Controls.TextBlock()
            text.Text <- sprintf "%d" (int score)
            text.FontSize <- 40.0
            let anim = new Media.Animation.DoubleAnimation();
            anim.From <- new Nullable<float>( 1.0 )
            anim.To <- new Nullable<float>( 0.0 )
            anim.Duration <- new System.Windows.Duration( System.TimeSpan.FromSeconds( 10.0 ) )
            text.BeginAnimation( 
                    Controls.TextBlock.OpacityProperty,
                    anim )
            circle.BeginAnimation( 
                    Shapes.Ellipse.OpacityProperty,
                    anim )
            polyline.BeginAnimation( 
                    Shapes.Polyline.OpacityProperty,
                    anim )
            Kimuraya.Concurrency.delay_func
                11000
                (fun () -> 
                    canvas.Children.Remove( text )
                    canvas.Children.Remove( circle )
                    canvas.Children.Remove( polyline))
            Controls.Canvas.SetLeft( text, a-30.0 )
            Controls.Canvas.SetTop( text, -b*2.0-20.0 )
            canvas.Children.Add( text ) |> ignore
            printfn "%f" score
        )
    do System.Windows.Forms.Application.Run( canvas |> createWPFForm )
    
